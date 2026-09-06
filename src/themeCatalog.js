// Publishing a custom theme to the catalog. The theme becomes a published
// slate of the person's own (its text is the theme file), then the slate is
// submitted for review. Which slate holds which theme is remembered on this
// device; the review state comes from the server.
import { API_URL } from './config';
import { encryptContent, encryptTitle } from './crypto';
import { getSlateKey } from './keyStore';

const KEY = 'justtype-theme-slates';
const links = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
};
const remember = (themeId, link) => {
  const all = links();
  if (link) all[themeId] = link; else delete all[themeId];
  localStorage.setItem(KEY, JSON.stringify(all));
};

export const themeSlate = (themeId) => links()[themeId] || null;
export const forgetThemeSlate = (themeId) => remember(themeId, null);

const api = (path, options = {}) => fetch(`${API_URL}${path}`, {
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  ...options,
});
const fail = async (res, fallback) => {
  const data = await res.json().catch(() => ({}));
  throw new Error(data.errors ? data.errors.join(', ') : data.error || fallback);
};

export async function publishTheme(theme, userId) {
  const content = JSON.stringify(theme, null, 2);
  const title = `${theme.name} theme`;
  const slateKey = await getSlateKey(userId);
  const body = {
    encryptedTitle: await encryptTitle(title, slateKey),
    encryptedContent: await encryptContent(content, slateKey),
    wordCount: content.trim().split(/\s+/).length,
    charCount: content.length,
    sizeBytes: new TextEncoder().encode(content).length,
  };

  // The slate: a new one, or the one this theme already has
  let link = themeSlate(theme.id);
  if (link) {
    const r = await api(`/slates/${link.slateNumber}`, { method: 'PUT', body: JSON.stringify(body) });
    if (r.status === 404) { forgetThemeSlate(theme.id); link = null; } else if (!r.ok) await fail(r, 'could not update the theme slate');
  }
  if (!link) {
    const r = await api('/slates', {
      method: 'POST',
      body: JSON.stringify({ ...body, editorMode: 'plain', clientRef: `theme-${theme.id}-${Date.now().toString(36)}` }),
    });
    if (!r.ok) await fail(r, 'could not create the theme slate');
    link = { slateNumber: (await r.json()).slate_number };
  }

  const p = await api(`/slates/${link.slateNumber}/publish`, {
    method: 'PATCH',
    body: JSON.stringify({ isPublished: true, publicContent: content, publicTitle: title }),
  });
  if (!p.ok) await fail(p, 'could not publish the theme slate');
  link.shareUrl = (await p.json()).share_url || link.shareUrl;

  const s = await api('/themes/submit', { method: 'POST', body: JSON.stringify({ slateNumber: link.slateNumber }) });
  if (!s.ok) await fail(s, 'could not submit the theme');
  remember(theme.id, link);
  return { ...link, status: (await s.json()).status };
}

// Takes the theme out of the catalog and out of review. The slate stays
// published; unpublishing it is the person's call, from the list.
export async function withdrawTheme(themeId) {
  const link = themeSlate(themeId);
  if (!link) return null;
  const r = await api(`/themes/submit/${link.slateNumber}`, { method: 'DELETE' });
  if (!r.ok) await fail(r, 'could not remove the theme');
  return link.slateNumber;
}

export async function myThemeStates() {
  const r = await api('/themes/mine');
  if (!r.ok) return {};
  return (await r.json()).themes || {};
}

export async function fetchCatalog() {
  const r = await api('/themes/catalog');
  if (!r.ok) await fail(r, 'could not load the catalog');
  return (await r.json()).themes || [];
}
