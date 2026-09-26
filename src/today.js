// `today`: the slate whose first line is today's date, or a new one.
//
// Titles are the first lines of slates, decrypted here in the browser, so
// the match is a date parse of each title, whatever style it was written
// in. A new one is written the way the app talks: lowercase, the weekday
// first, in the device's language.
import { API_URL } from './config';
import { decryptTitle, unwrapKey } from './crypto';
import { getSlateKey } from './keyStore';

export const DAILY_TAG = 'daily';

export const todayLine = (d = new Date()) =>
  d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toLowerCase();

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// The day a title names, or null. ISO first, then day.month.year in the
// device's order, then whatever the date parser makes of the words.
export function parseTitleDate(title) {
  const t = (title || '').trim().replace(/^#{1,6}\s+/, '');
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/);
  if (m) {
    const a = +m[1]; const b = +m[2];
    let dayFirst = a > 12 ? true : b > 12 ? false : null;
    if (dayFirst === null) {
      const parts = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'numeric' }).formatToParts(new Date(2000, 1, 3));
      dayFirst = parts.findIndex(p => p.type === 'day') < parts.findIndex(p => p.type === 'month');
    }
    return dayFirst ? new Date(+m[3], b - 1, a) : new Date(+m[3], a - 1, b);
  }
  // Natural words: only the part before a separator that would end a date
  const words = t.split(/\s[-–|:]\s|\n/)[0];
  if (!/\d{4}/.test(words)) return null;
  const parsed = Date.parse(words.replace(/^(\w+),?\s+/i, (w, day) => (/day$/i.test(day) ? '' : w)));
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

// Today's slate, as a list row { slate_number }, or null
export async function findTodaySlate(userId) {
  const res = await fetch(`${API_URL}/slates`, { credentials: 'include' });
  if (!res.ok) throw new Error('slates unavailable');
  const rows = await res.json();
  const master = userId ? await getSlateKey(userId) : null;
  const today = new Date();
  for (const row of rows) {
    if (row.archived_at || row.deleted_at) continue;
    let title = row.title;
    if (!title && row.encrypted_title && master) {
      try {
        const key = row.is_collab && row.collab_wrapped_key ? await unwrapKey(row.collab_wrapped_key, master) : master;
        title = await decryptTitle(row.encrypted_title, key);
      } catch { continue; }
    }
    const d = parseTitleDate(title);
    if (d && sameDay(d, today)) return row;
  }
  return null;
}
