// B2 files leave through a queue (b2_pending_deletes) instead of inside the
// request that replaced or removed them.
//
// Why a queue: a save used to wait on two more B2 calls (look up the old
// file's name, delete it) before it answered; a failed delete was logged and
// the file stayed in B2 for good; and a replaced version was gone the moment
// the save landed, so restoring last night's database pointed every slate
// edited since at a file that no longer existed.
//
// Two waits: a version replaced by a newer save stays for a week, long
// enough for any database restore we would realistically do. Content the
// person deleted (the trash emptied, a slate or an account removed) goes
// within the hour: the privacy page promises a deleted account is gone
// within 24 hours.
//
// Before deleting, the worker checks that no row still points at the file.
// A file that is referenced again is left alone: losing a live file is the
// one thing this must never do (see the 2026-08 incident).

const db = require('./database');
const b2Storage = require('./b2Storage');

const REPLACED_DELAY_S = 7 * 24 * 60 * 60;
const REMOVED_DELAY_S = 60 * 60;
const TICK_MS = 60 * 1000;
const BATCH = 25;

const insertStmt = db.prepare('INSERT INTO b2_pending_deletes (file_id, file_name, not_before, reason) VALUES (?, ?, ?, ?)');
const dueStmt = db.prepare('SELECT id, file_id, file_name, attempts FROM b2_pending_deletes WHERE not_before <= ? ORDER BY not_before LIMIT ?');
const doneStmt = db.prepare('DELETE FROM b2_pending_deletes WHERE id = ?');
const retryStmt = db.prepare('UPDATE b2_pending_deletes SET attempts = attempts + 1, last_error = ?, not_before = ? WHERE id = ?');
const referencedStmt = db.prepare(`
  SELECT 1 FROM slates WHERE b2_file_id = @id OR b2_public_file_id = @id OR history_b2_file_id = @id
  UNION ALL SELECT 1 FROM collab_docs WHERE snapshot_b2_file_id = @id
  UNION ALL SELECT 1 FROM collab_checkpoints WHERE b2_file_id = @id
  LIMIT 1
`);

const now = () => Math.floor(Date.now() / 1000);

function enqueue(fileIds, reason, delaySeconds) {
  const due = now() + delaySeconds;
  const seen = new Set();
  for (const fileId of fileIds) {
    if (!fileId || seen.has(fileId)) continue;
    seen.add(fileId);
    insertStmt.run(fileId, b2Storage.knownFileName(fileId), due, reason);
  }
}

// A version a newer save (or share, history bundle, snapshot) replaced
const replaced = (...fileIds) => enqueue(fileIds.flat(), 'replaced', REPLACED_DELAY_S);
// Content the person deleted
const removed = (...fileIds) => enqueue(fileIds.flat(), 'removed', REMOVED_DELAY_S);

let running = false;
async function drain() {
  if (running) return;
  running = true;
  try {
    const rows = dueStmt.all(now(), BATCH);
    for (const row of rows) {
      if (referencedStmt.get({ id: row.file_id })) {
        console.warn(`b2 delete queue: ${row.file_id} is referenced again, left in place`);
        doneStmt.run(row.id);
        continue;
      }
      try {
        await b2Storage.deleteSlate(row.file_id, row.file_name);
        doneStmt.run(row.id);
      } catch (err) {
        if (err && err.code === 'B2_NOT_FOUND') { doneStmt.run(row.id); continue; }
        // Back off: a minute, then doubling, capped at six hours
        const wait = Math.min(60 * 2 ** row.attempts, 6 * 60 * 60);
        retryStmt.run(String(err && err.message || err).slice(0, 300), now() + wait, row.id);
      }
    }
  } catch (err) {
    console.error('b2 delete queue error:', err);
  } finally {
    running = false;
  }
}

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(drain, TICK_MS);
  timer.unref();
}

module.exports = { replaced, removed, drain, start, REPLACED_DELAY_S, REMOVED_DELAY_S };
