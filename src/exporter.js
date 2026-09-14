// Export shapes shared by the writer and the list: a markdown file with or
// without front matter (a device setting), several slates as a zip with a
// file per slate named after it, and several slates joined into one text
// for printing.
import { makePref } from './pref';

export const FRONT_MATTER = ['off', 'on'];
const pref = makePref({ key: 'justtype-front-matter', values: FRONT_MATTER, fallback: 'off' });
export const readFrontMatter = pref.get;
export const setFrontMatter = pref.set;
export const useFrontMatter = pref.use;
export const nextFrontMatter = pref.next;

const iso = (d) => { const t = d ? Date.parse(d) : NaN; return Number.isNaN(t) ? null : new Date(t).toISOString(); };
const yamlText = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// Markdown with the slate's facts in front matter when asked
export function markdownOf({ title, text, created, updated, tags = [] }, frontMatter = readFrontMatter()) {
  if (frontMatter !== 'on') return text;
  const lines = ['---', `title: ${yamlText(title || 'untitled slate')}`];
  const c = iso(created); const u = iso(updated);
  if (c) lines.push(`created: ${c}`);
  if (u) lines.push(`updated: ${u}`);
  if (tags.length) lines.push(`tags: [${tags.map(yamlText).join(', ')}]`);
  lines.push('---', '');
  return `${lines.join('\n')}\n${text}`;
}

// A file name from a slate's title, safe on every system, unique in a set
export function fileNameFor(title, ext, taken = new Set()) {
  const base = (title || 'untitled slate').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled slate';
  let name = `${base}.${ext}`;
  for (let i = 2; taken.has(name); i++) name = `${base} (${i}).${ext}`;
  taken.add(name);
  return name;
}

// Several slates as a zip: one text or markdown file each, named after the slate
export async function zipOf(items, format, frontMatter = readFrontMatter()) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const taken = new Set();
  for (const item of items) {
    const body = format === 'md' ? markdownOf(item, frontMatter) : item.text;
    zip.file(fileNameFor(item.title, format, taken), body);
  }
  return zip.generateAsync({ type: 'blob' });
}

export function downloadText(text, filename, type = 'text/plain') {
  downloadBlob(new Blob([text], { type }), filename);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
