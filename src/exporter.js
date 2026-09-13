// Export shapes shared by the writer and the list: a markdown file with or
// without front matter (a device setting), and several slates joined into
// one text or markdown file, each under its own heading.
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

// Several slates as one file. Markdown: a heading per slate; text: the
// title underlined; both separated by a rule.
export function combined(items, format, frontMatter = readFrontMatter()) {
  const parts = items.map(({ title, text, created, updated, tags = [] }) => {
    const t = title || 'untitled slate';
    const body = text.replace(/\s+$/, '');
    if (format === 'md') {
      const head = frontMatter === 'on' ? markdownOf({ title: t, text: '', created, updated, tags }, 'on').replace(/\n$/, '') + '\n\n' : '';
      const withoutTitleLine = body.split('\n')[0].trim().replace(/^#{1,6}\s+/, '') === t ? body.split('\n').slice(1).join('\n').replace(/^\n+/, '') : body;
      return `${head}# ${t}\n\n${withoutTitleLine}`;
    }
    return `${t}\n${'='.repeat(Math.min(t.length, 60))}\n\n${body}`;
  });
  return parts.join(format === 'md' ? '\n\n---\n\n' : '\n\n\n');
}

export function downloadText(text, filename, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
