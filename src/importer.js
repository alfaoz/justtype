// Import: text and markdown files, folders of them, and justtype's own
// export zip, each becoming a slate. Everything is read and encrypted in the
// browser; the server takes a batch of ciphertext. Offline, the slates
// become local ones that sync later, the way an offline save does.
import { API_URL } from './config';
import { encryptContent, encryptTitle, encryptTags } from './crypto';
import { getSlateKey } from './keyStore';
import { cacheSlate, queuePending, newLocalSlateNumber } from './offlineStore';
import { isOnline } from './connectivity';

const TEXT_EXT = /\.(txt|md|markdown|text)$/i;
const BATCH = 50;

// The files behind a drop, folders walked
export async function filesFromDataTransfer(dt) {
  const items = dt?.items ? [...dt.items] : [];
  const entries = items.map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return [...(dt?.files || [])];
  const out = [];
  const walk = (entry) => new Promise((resolve) => {
    if (entry.isFile) { entry.file((f) => { out.push(f); resolve(); }, () => resolve()); return; }
    if (!entry.isDirectory) { resolve(); return; }
    const reader = entry.createReader();
    const readAll = () => reader.readEntries(async (batch) => {
      if (!batch.length) { resolve(); return; }
      for (const e of batch) await walk(e);
      readAll();
    }, () => resolve());
    readAll();
  });
  for (const e of entries) await walk(e);
  return out;
}

const clean = (text) => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

// justtype's export header: "Title: …\nCreated: …\nLast Updated: …\nTags: …\n\n"
function parseExportHeader(text) {
  const m = text.match(/^Title: (.*)\nCreated: (.*)\nLast Updated: (.*)\n(?:Tags: (.*)\n)?\n/);
  if (!m) return { text };
  const date = (s) => { const d = Date.parse(s); return Number.isNaN(d) ? null : new Date(d).toISOString(); };
  return {
    title: m[1].trim() || null,
    createdAt: date(m[2]),
    updatedAt: date(m[3]),
    tags: m[4] ? m[4].split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [],
    text: text.slice(m[0].length),
  };
}

const titleOf = (text, name) => {
  const first = (text.split('\n')[0] || '').trim().replace(/^#{1,6}\s+/, '');
  return first || name.replace(/\.[^.]+$/, '') || 'untitled slate';
};

// Files to items { title, text, tags, createdAt, updatedAt, editorMode }
export async function itemsFromFiles(files) {
  const items = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(f);
      for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir || !TEXT_EXT.test(name)) continue;
        const parsed = parseExportHeader(clean(await entry.async('string')));
        items.push(itemOf(parsed, name));
      }
      continue;
    }
    if (!TEXT_EXT.test(f.name) && f.type && !f.type.startsWith('text/')) continue;
    const parsed = parseExportHeader(clean(await f.text()));
    items.push(itemOf(parsed, f.name));
  }
  return items.filter(i => i.text.trim());
}
const itemOf = (parsed, name) => ({
  title: parsed.title || titleOf(parsed.text, name.split('/').pop()),
  text: parsed.text,
  tags: parsed.tags || [],
  createdAt: parsed.createdAt || null,
  updatedAt: parsed.updatedAt || null,
  editorMode: /\.(md|markdown)$/i.test(name) ? 'wysiwyg' : 'plain',
});

const payloadOf = async (item, key) => ({
  encryptedContent: await encryptContent(item.text, key),
  encryptedTitle: await encryptTitle(item.title, key),
  encryptedTags: item.tags.length ? await encryptTags(item.tags, key) : null,
  wordCount: item.text.trim() ? item.text.trim().split(/\s+/).length : 0,
  charCount: item.text.length,
  sizeBytes: new TextEncoder().encode(item.text).length,
  editorMode: item.editorMode,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

// Make the slates. Returns { created, failed }.
export async function importItems(userId, items, onProgress = null) {
  const key = userId ? await getSlateKey(userId) : null;
  if (!key) throw new Error('locked');
  let created = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    const payloads = [];
    for (const item of chunk) payloads.push(await payloadOf(item, key));
    onProgress?.(Math.min(i + chunk.length, items.length), items.length);
    if (isOnline()) {
      try {
        const res = await fetch(`${API_URL}/slates/batch`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ slates: payloads }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'import failed');
        created += data.created?.length || 0;
        failed += data.failed || 0;
        continue;
      } catch (err) {
        if (err.message !== 'Failed to fetch') { failed += chunk.length; continue; }
      }
    }
    // Offline: local slates that sync when the network is back
    for (const body of payloads) {
      const local = newLocalSlateNumber();
      await cacheSlate(userId, local, {
        slate_number: local, local: true, encrypted: true,
        encryptedContent: body.encryptedContent, encrypted_title: body.encryptedTitle,
        editor_mode: body.editorMode, is_published: 0, share_id: null, updated_at: null,
        word_count: body.wordCount, char_count: body.charCount,
      });
      await queuePending(userId, local, { op: 'post', body, editorMode: body.editorMode });
      created++;
    }
  }
  return { created, failed };
}
