// What a crawler gets.
//
// Every html route that is not the bare app shell goes through here: the
// per-page title and description, the canonical url, the social card,
// robots.txt and sitemap.xml, and the published slate pages with their text
// in the html so a search engine does not have to run the app to read them.
//
// The home page carries its own head and a short pre-rendered pitch inside
// the built index.html itself, so `/` keeps serving the exact bytes of
// dist/index.html (the integrity monitor compares the two). Every other page
// is that same file with the home-only parts swapped for its own. The words
// live in src/pages.json, shared with the client so tab titles match.

const fs = require('fs');
const path = require('path');
const pages = require('../src/pages.json');

const SITE = 'https://justtype.io';
const CANONICAL_HOST = 'justtype.io';
const DIST_INDEX = path.join(__dirname, '..', 'dist', 'index.html');
const OG_IMAGE = `${SITE}/og.png`;

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

// The built shell, re-read only when a deploy replaces it
let shellCache = { mtime: 0, html: '' };
function shell() {
  const { mtimeMs } = fs.statSync(DIST_INDEX);
  if (mtimeMs !== shellCache.mtime) shellCache = { mtime: mtimeMs, html: fs.readFileSync(DIST_INDEX, 'utf8') };
  return shellCache.html;
}

// One page out of the shell: swap the title and description, drop the
// home-only head and pitch, add this page's tags and, for a slate, its text
// where the app will mount.
function render({ title, description, canonical, robots, type = 'website', card = 'summary', body = '' }) {
  const tab = title ? `${title} · ${pages.brand}` : pages.home.title;
  const social = escapeHtml(title || pages.brand);
  const head = [
    canonical && `<link rel="canonical" href="${canonical}" />`,
    robots && `<meta name="robots" content="${robots}" />`,
    `<meta property="og:site_name" content="${pages.brand}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:title" content="${social}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    canonical && `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta name="twitter:card" content="${card}" />`,
    `<meta name="twitter:title" content="${social}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
  ].filter(Boolean).map((l) => `    ${l}`).join('\n');
  return shell()
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(tab)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(description)}" />`)
    .replace(/\s*<!-- jt:home -->[\s\S]*?<!-- \/jt:home -->/, '')
    .replace(/<!-- jt:prerender -->[\s\S]*?<!-- \/jt:prerender -->/, body)
    .replace('</head>', `${head}\n  </head>`);
}

function send(res, html, status = 200) {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(html);
}

// Just enough markdown for a readable page: headings, lists, code, emphasis,
// links. The app renders the real thing once it mounts. Text is escaped
// before any of this runs, so nothing here can introduce markup of its own.
function inline(text) {
  return text
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="nofollow ugc">$1</a>');
}

function toHtml(content, markdown) {
  return escapeHtml(content).replace(/\r\n?/g, '\n').split(/\n{2,}/).map((block) => {
    const b = block.trim();
    if (!b) return '';
    if (!markdown) return `<p>${b.replace(/\n/g, '<br />')}</p>`;
    const heading = b.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);
      return `<h${level}>${inline(heading[2])}</h${level}>`;
    }
    if (/^(?:[-*]\s+.*(?:\n|$))+$/.test(b)) {
      return `<ul>${b.split('\n').map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    if (b.startsWith('```')) return `<pre>${b.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')}</pre>`;
    return `<p>${inline(b).replace(/\n/g, '<br />')}</p>`;
  }).join('\n');
}

// The first line and a half of a slate, as its search snippet
function summary(content) {
  const text = String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^[\s>#*-]+/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 155 ? `${text.slice(0, 152).trimEnd()}...` : text;
}

function article(slate, content, author) {
  return `<main class="jt-pre"><article>
      <h1>${escapeHtml(slate.title || 'untitled')}</h1>
      <p class="jt-pre-by">slate by ${escapeHtml(author)}</p>
      ${toHtml(content, slate.editor_mode === 'wysiwyg')}
    </article></main>`;
}

// Published text, fetched once per version of a slate. Crawlers revisit, and
// a page view should not cost a storage read every time.
const contentCache = new Map();
async function slateContent(b2Storage, slate) {
  const key = `${slate.share_id}:${slate.updated_at}`;
  const hit = contentCache.get(slate.share_id);
  if (hit && hit.key === key) return hit.content;
  const content = await b2Storage.getSlate(slate.b2_public_file_id || slate.b2_file_id, null);
  if (contentCache.size >= 300) contentCache.delete(contentCache.keys().next().value);
  contentCache.set(slate.share_id, { key, content });
  return content;
}

function robotsTxt(host) {
  if (host !== CANONICAL_HOST) return 'User-agent: *\nDisallow: /\n';
  return ['User-agent: *', ...pages.private.map((p) => `Disallow: ${p}`), '', `Sitemap: ${SITE}/sitemap.xml`, ''].join('\n');
}

// The sitemap is the site: its pages and the four documents. A published
// slate is a link its author hands out, not a page to be found by search,
// so none of them are listed here and the ones that are not the documents
// carry noindex below.
function sitemapXml() {
  const urls = [
    '/',
    ...Object.entries(pages.pages).filter(([, p]) => p.index !== false).map(([route]) => route),
    ...Object.keys(pages.docs).map((id) => `/s/${id}`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    urls.map((p) => `  <url><loc>${SITE}${escapeHtml(p)}</loc></url>`).join('\n')
  }\n</urlset>\n`;
}

module.exports = function mountSeo(app, { db, b2Storage }) {
  // beta and the old domain are not a second copy of the site
  app.use((req, res, next) => {
    if (req.hostname !== CANONICAL_HOST) res.setHeader('X-Robots-Tag', 'noindex');
    next();
  });

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(robotsTxt(req.hostname));
  });
  app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml').send(sitemapXml());
  });

  // /terms and friends: a real redirect to the slate, which is the url that
  // stays. The client used to bounce with window.location; a 301 is what a
  // search engine can follow and consolidate.
  for (const id of Object.keys(pages.docs)) {
    app.get(`/${id}`, (req, res) => res.redirect(301, `/s/${id}`));
  }

  for (const [route, page] of Object.entries(pages.pages)) {
    app.get(route, (req, res) => send(res, render({
      title: page.title,
      description: page.description,
      canonical: `${SITE}${route}`,
      robots: page.index === false ? 'noindex' : undefined,
    })));
  }

  // Signed-in screens and one-time links: the shell, kept out of the index
  const privateRoutes = pages.private
    .filter((p) => !p.startsWith('/api') && !p.startsWith('/oauth'))
    .map((p) => (p.endsWith('/') ? `${p}*` : p));
  app.get(privateRoutes, (req, res) => send(res, render({
    title: pages.brand,
    description: pages.home.description,
    robots: 'noindex',
  })));

  // A published slate, with its text in the page
  app.get('/s/:shareId', async (req, res) => {
    const id = req.params.shareId;
    let slate = null;
    try {
      slate = db.prepare(`
        SELECT slates.*, users.username, users.is_system_user
        FROM slates
        JOIN users ON slates.user_id = users.id
        WHERE slates.share_id = ? AND slates.is_published = 1
      `).get(id);
    } catch (error) {
      console.error('seo: slate lookup', error);
    }
    if (!slate) {
      return send(res, render({ title: 'not found', description: pages.home.description, robots: 'noindex' }), 404);
    }
    const author = slate.is_system_user ? 'alfaoz' : slate.username;
    const doc = pages.docs[id];
    let content = '';
    try {
      content = await slateContent(b2Storage, slate);
    } catch (error) {
      console.error('seo: slate content', error.message || error);
    }
    send(res, render({
      title: (slate.title || doc?.title || 'untitled').slice(0, 70),
      description: doc ? doc.description : (summary(content) || `slate by ${author}`),
      canonical: `${SITE}/s/${encodeURIComponent(id)}`,
      robots: doc ? undefined : 'noindex',
      type: 'article',
      body: article(slate, content, author),
    }));
  });
};
