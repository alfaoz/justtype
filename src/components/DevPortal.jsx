import React, { useState, useEffect, useRef } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';

const SCOPE_OPTIONS = [
  ['identity', strings.dev.scopes.identity],
  ['email', strings.dev.scopes.email],
  ['slates:read:public', strings.dev.scopes.public],
  ['slates:read:meta', strings.dev.scopes.meta],
  ['slates:read:private', strings.dev.scopes.private],
  ['slates:write', strings.dev.scopes.write],
  ['slates:create', strings.dev.scopes.create],
  ['slates:delete', strings.dev.scopes.delete],
  ['slates:publish', strings.dev.scopes.publish]
];

const LANGUAGES = [
  ['node', 'node / express', 'server-side javascript'],
  ['browser', 'browser (spa)', 'react, vue, vanilla'],
  ['python', 'python / flask', 'server-side python'],
  ['curl', 'curl', 'shell / testing']
];

// ---- code generators (filled with the user's real client) ----------------
const origin = typeof window !== 'undefined' ? window.location.origin : 'https://justtype.io';

function genNode(clientId, redirectUri, scope) {
  return `const crypto = require('crypto');
const CLIENT_ID = '${clientId}';
const REDIRECT_URI = '${redirectUri}';
const JT = '${origin}';
const SCOPE = '${scope}';

const b64url = (buf) => buf.toString('base64')
  .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');

// 1. send the user to justtype to authorize
app.get('/login', (req, res) => {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  req.session.pkce = { verifier, state };   // remember for the callback

  const url = new URL(JT + '/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  res.redirect(url.toString());
});

// 2. justtype redirects back here with ?code=
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  if (state !== req.session.pkce.state) return res.status(400).send('bad state');

  const tokenRes = await fetch(JT + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      code_verifier: req.session.pkce.verifier,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI
    })
  });
  const tok = await tokenRes.json();   // { access_token, refresh_token, ... }

  const me = await (await fetch(JT + '/api/oauth/userinfo', {
    headers: { Authorization: 'Bearer ' + tok.access_token }
  })).json();

  // me => { id, username${scope.includes('email') ? ', email' : ''} }
  res.json(me);
});`;
}

function genBrowser(clientId, redirectUri, scope) {
  return `const CLIENT_ID = '${clientId}';
const REDIRECT_URI = '${redirectUri}';
const JT = '${origin}';
const SCOPE = '${scope}';

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');

async function sha256(str) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)));
}

// 1. kick off login
async function login() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('pkce_state', state);

  const challenge = b64url(await sha256(verifier));
  const url = new URL(JT + '/oauth/authorize');
  url.search = new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
    scope: SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256'
  });
  location.href = url.toString();
}

// 2. on your redirect page, finish the exchange
async function handleCallback() {
  const p = new URLSearchParams(location.search);
  if (p.get('state') !== sessionStorage.getItem('pkce_state')) throw new Error('bad state');

  const res = await fetch(JT + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: p.get('code'),
      code_verifier: sessionStorage.getItem('pkce_verifier'),
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI
    })
  });
  const tok = await res.json();   // keep tok.access_token in memory (not localStorage)

  const me = await (await fetch(JT + '/api/oauth/userinfo', {
    headers: { Authorization: 'Bearer ' + tok.access_token }
  })).json();
  return me;
}`;
}

function genPython(clientId, redirectUri, scope) {
  return `import os, base64, hashlib, secrets, requests
from urllib.parse import urlencode
from flask import Flask, request, redirect, session, jsonify

CLIENT_ID = "${clientId}"
REDIRECT_URI = "${redirectUri}"
JT = "${origin}"
SCOPE = "${scope}"

def b64url(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")

@app.get("/login")
def login():
    verifier = b64url(secrets.token_bytes(32))
    state = b64url(secrets.token_bytes(16))
    session["verifier"], session["state"] = verifier, state
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    params = urlencode({
        "response_type": "code", "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI, "scope": SCOPE, "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256",
    })
    return redirect(JT + "/oauth/authorize?" + params)

@app.get("/callback")
def callback():
    if request.args.get("state") != session.get("state"):
        return "bad state", 400
    tok = requests.post(JT + "/oauth/token", json={
        "grant_type": "authorization_code",
        "code": request.args.get("code"),
        "code_verifier": session["verifier"],
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
    }).json()
    me = requests.get(JT + "/api/oauth/userinfo",
        headers={"Authorization": "Bearer " + tok["access_token"]}).json()
    return jsonify(me)`;
}

function genCurl(clientId, redirectUri, scope) {
  return `# 1. make a PKCE pair
VERIFIER=$(openssl rand -hex 32)
CHALLENGE=$(printf %s "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 \\
  | tr '+/' '-_' | tr -d '=')

# 2. open this URL in a browser, approve, copy the ?code= from the redirect
echo "${origin}/oauth/authorize?response_type=code\\
&client_id=${clientId}\\
&redirect_uri=${encodeURIComponent(redirectUri)}\\
&scope=${encodeURIComponent(scope)}\\
&state=xyz&code_challenge=$CHALLENGE&code_challenge_method=S256"

# 3. exchange the code for tokens
curl ${origin}/oauth/token -H 'Content-Type: application/json' -d '{
  "grant_type": "authorization_code",
  "code": "<paste code>",
  "code_verifier": "'"$VERIFIER"'",
  "client_id": "${clientId}",
  "redirect_uri": "${redirectUri}"
}'

# 4. call the api
curl ${origin}/api/oauth/userinfo -H "Authorization: Bearer <access_token>"`;
}

const GENERATORS = { node: genNode, browser: genBrowser, python: genPython, curl: genCurl };

// Node snippet showing how an app decrypts a private slate the user delegated to it.
const DECRYPT_SNIPPET = `const { privateDecrypt, createDecipheriv, constants } = require('crypto');
const PRIVATE_KEY = process.env.JT_PRIVATE_KEY;   // this install's RSA private key (registered via POST /api/oauth/devices)
const JT = '${origin}';

const b64 = (s) => Buffer.from(s, 'base64');
function aesGcmDecrypt(blob, key) {
  const data = b64(blob);
  const iv = data.subarray(0, 16), tag = data.subarray(16, 32), ct = data.subarray(32);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// 1. fetch a slate the user shared with you (needs scope slates:read:private)
const slate = await (await fetch(JT + '/api/oauth/slates/' + slateNumber, {
  headers: { Authorization: 'Bearer ' + accessToken }
})).json();
if (!slate.delegated) throw new Error('this slate has not been shared with your app');

// 2. unwrap the per-slate content key with YOUR private key
const contentKey = privateDecrypt(
  { key: PRIVATE_KEY, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
  b64(slate.wrapped_key)
);

// 3. decrypt content + title with that key
const content = JSON.parse(aesGcmDecrypt(slate.enc_content, contentKey)).content;
const title = slate.enc_title ? aesGcmDecrypt(slate.enc_title, contentKey) : null;

// tip: GET /api/oauth/shared lists every slate the user has delegated to you`;

// Node snippet showing how an app writes back to a delegated private slate.
const WRITE_SNIPPET = `const { privateDecrypt, createCipheriv, randomBytes, constants } = require('crypto');

const b64 = (s) => Buffer.from(s, 'base64');
function aesGcmEncrypt(plaintext, key) {
  const iv = randomBytes(16);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  // justtype blob format: IV(16) + AuthTag(16) + Ciphertext, base64
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

// 1. GET the slate first so you have the CURRENT content key (the user's own
//    edits rotate it). Reuse this exact key — do NOT generate a new one.
const slate = await (await fetch(JT + '/api/oauth/slates/' + slateNumber, {
  headers: { Authorization: 'Bearer ' + accessToken }
})).json();
const contentKey = privateDecrypt(
  { key: PRIVATE_KEY, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
  b64(slate.wrapped_key)
);

// 2. content is wrapped as JSON { content, uploadedAt }; title is a raw string
const enc_content = aesGcmEncrypt(
  JSON.stringify({ content: newText, uploadedAt: new Date().toISOString() }), contentKey);
const enc_title = newTitle ? aesGcmEncrypt(newTitle, contentKey) : null;

// 3. PATCH it back — the user's client merges this on next open
await fetch(JT + '/api/oauth/slates/' + slateNumber + '/delegated', {
  method: 'PATCH',
  headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
  body: JSON.stringify({ enc_content, enc_title,
    word_count: newText.trim().split(/\\s+/).length, char_count: newText.length })
});`;

// Node snippet showing how an app drops a NEW private slate to the user (the
// drop box). Wraps the content key to the USER's public key — the mirror image
// of delegation, which wraps to the app's key.
const DROP_SNIPPET = `const { publicEncrypt, createCipheriv, randomBytes, constants } = require('crypto');

function aesGcmEncrypt(plaintext, key) {
  const iv = randomBytes(16);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); // IV+tag+ct
}

// 1. fetch the USER's public key. null => they have no keypair yet; retry later.
const { public_key } = await (await fetch(JT + '/api/oauth/users/me/public-key', {
  headers: { Authorization: 'Bearer ' + accessToken } })).json();
if (!public_key) throw new Error('keypair_unavailable');

// 2. fresh content key; 3. encrypt content (JSON) + title (raw string)
const contentKey = randomBytes(32);
const enc_content = aesGcmEncrypt(
  JSON.stringify({ content: text, uploadedAt: new Date().toISOString() }), contentKey);
const enc_title = title ? aesGcmEncrypt(title, contentKey) : null;

// 4. wrap the content key to the USER's RSA-OAEP-SHA256 public key
const userPem = '-----BEGIN PUBLIC KEY-----\\n' +
  public_key.match(/.{1,64}/g).join('\\n') + '\\n-----END PUBLIC KEY-----';
const wrapped_key = publicEncrypt(
  { key: userPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
  contentKey).toString('base64');

// 5. drop it — appears in the user's account next time they open justtype
await fetch(JT + '/api/oauth/slates/drop', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
  body: JSON.stringify({ wrapped_key, enc_content, enc_title })
});`;

const METHOD_COLOR = { GET: 'text-green-400', POST: 'text-blue-400', DELETE: 'text-red-400', PUT: 'text-orange-400', PATCH: 'text-orange-400' };

// Lightweight syntax highlighter. It NEVER alters the code text — it only wraps
// matched tokens in colored spans, so the displayed code is always exact and the
// worst case is a slightly-off color. Comments use a negative lookbehind so URLs
// (https://) and regex (/\//) are not mistaken for line comments.
const HL = /(?<![:\\/])\/\/[^\n]*|#[^\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\b(?:const|let|var|async|await|function|return|new|if|else|for|while|try|catch|throw|import|from|export|class|def|lambda|with|as|require)\b|\b(?:true|false|null|None|True|False)\b|\b(?:0x[0-9a-fA-F]+|\d+)\b/g;

function highlightCode(code) {
  const out = [];
  let last = 0, m, i = 0;
  HL.lastIndex = 0;
  while ((m = HL.exec(code)) !== null) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const t = m[0];
    let cls;
    if (t.startsWith('//') || t.startsWith('#')) cls = 'text-[#666] italic';
    else if (t[0] === "'" || t[0] === '"' || t[0] === '`') cls = 'text-green-400';
    else if (/^(true|false|null|None|True|False)$/.test(t)) cls = 'text-orange-400';
    else if (/^(0x|\d)/.test(t)) cls = 'text-orange-400';
    else cls = 'text-blue-400';
    out.push(<span key={i++} className={cls}>{t}</span>);
    last = m.index + t.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

// ---- small shared pieces (module-level so they never remount) -------------

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#111111] text-[#d4d4d4] overflow-y-auto">
      <header className="border-b border-[#222] sticky top-0 bg-[#111111] z-30">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <a href="/" className="text-sm text-[#808080] hover:text-white transition-colors">← justtype</a>
            <span className="text-[#333]">/</span>
            <span className="text-sm text-white">developers</span>
          </div>
          <span className="text-[11px] tracking-[0.2em] uppercase text-[#666]">api v1</span>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-5 py-10">{children}</main>
    </div>
  );
}

function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <div className="relative group rounded-xl border border-[#333] bg-[#0a0a0a] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#222]">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#333]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#333]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#333]" />
        </div>
        <button
          onClick={copy}
          className="text-xs px-2.5 py-1 rounded-md bg-[#1a1a1a] text-[#a0a0a0] hover:text-white border border-[#333] transition-colors"
        >
          {copied ? strings.dev.copied : strings.dev.copy}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-xs leading-relaxed text-[#d4d4d4] whitespace-pre">{highlightCode(code)}</pre>
    </div>
  );
}

function Chip({ children }) {
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-md bg-[#222] text-[#a0a0a0] font-mono">{children}</span>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-xs text-[#808080] mb-1.5 flex items-baseline gap-2">
        {label}{hint && <span className="text-[#666]">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full bg-[#0a0a0a] border border-[#333] rounded-lg px-3.5 py-2.5 text-sm text-white ' +
  'placeholder:text-[#666] focus:outline-none focus:border-[#666] transition-colors';

// justtype-style centered modal. Closes on overlay click or Escape.
function Modal({ title, subtitle, onClose, children, maxWidth = 'max-w-md' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-[modalOverlayIn_0.15s_ease-out]"
      onClick={onClose}
    >
      <div
        className={`bg-[#1a1a1a] border border-[#333] rounded-xl p-6 w-full ${maxWidth} animate-[modalContentIn_0.18s_ease-out] max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h2 className="text-lg text-white mb-1">{title}</h2>}
        {subtitle && <p className="text-sm text-[#808080] mb-5 leading-relaxed">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

const ROLE_STYLE = {
  owner: 'bg-white/10 text-white border-white/20',
  editor: 'bg-blue-400/10 text-blue-300 border-blue-400/20',
  viewer: 'bg-[#222] text-[#a0a0a0] border-[#333]'
};

function RoleBadge({ role }) {
  const label = role === 'owner' ? strings.dev.apps.ownerBadge
    : role === 'editor' ? strings.dev.apps.editorBadge
    : strings.dev.apps.viewerBadge;
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border ${ROLE_STYLE[role] || ROLE_STYLE.viewer}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------

export function DevPortal({ token, username, onLogin }) {
  const [tab, setTab] = useState('docs');

  // apps
  const [apps, setApps] = useState([]);
  const [loadingApps, setLoadingApps] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [redirects, setRedirects] = useState('');
  const [scopes, setScopes] = useState(['identity']);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [newSecret, setNewSecret] = useState(null);

  // wizard
  const [wizStep, setWizStep] = useState(1);
  const [wizAppId, setWizAppId] = useState('');
  const [wizLang, setWizLang] = useState('node');

  // invite-link onboarding (?join=<token>)
  const [joinToken, setJoinToken] = useState(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('join');
  });

  const dismissJoin = () => {
    setJoinToken(null);
    // drop the ?join= param without a reload
    window.history.replaceState({}, '', '/dev');
  };

  const onJoined = () => {
    dismissJoin();
    setTab('apps');
    loadApps();
  };

  useEffect(() => {
    if (token) loadApps();
  }, [token]);

  const loadApps = async () => {
    setLoadingApps(true);
    try {
      const res = await fetch(`${API_URL}/oauth/clients`, { credentials: 'include' });
      const data = await res.json();
      if (res.ok) setApps(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    finally { setLoadingApps(false); }
  };

  const toggleScope = (s) =>
    setScopes((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);

  const createApp = async (e) => {
    e.preventDefault();
    setCreateError('');
    const redirect_uris = redirects.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (!name.trim()) return setCreateError(strings.dev.errors.nameRequired);
    if (redirect_uris.length === 0) return setCreateError(strings.dev.errors.redirectRequired);
    if (scopes.length === 0) return setCreateError(strings.dev.errors.scopeRequired);
    setCreating(true);
    try {
      // Private-slate access uses PER-INSTALLATION key delegation: there is no app
      // keypair created here. Each install generates its own RSA keypair at runtime
      // and registers the public half via POST /api/oauth/devices after authorizing
      // (see the developer reference, §6). Nothing secret is minted at registration.
      const res = await fetch(`${API_URL}/oauth/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: name.trim(), website: website.trim() || undefined, redirect_uris, scopes })
      });
      const data = await res.json();
      if (res.ok) {
        setShowCreate(false);
        setName(''); setWebsite(''); setRedirects(''); setScopes(['identity']);
        if (data.client_secret) setNewSecret({ id: data.client_id, secret: data.client_secret });
        loadApps();
      } else {
        setCreateError(data.error || strings.dev.errors.createFailed);
      }
    } catch {
      setCreateError(strings.dev.errors.createFailed);
    } finally {
      setCreating(false);
    }
  };

  if (!token) {
    return (
      <Shell>
        <div className="text-center py-24">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#1a1a1a] border border-[#333] mb-6 text-xl">{'</>'}</div>
          <h1 className="text-2xl text-white mb-3">{strings.dev.title}</h1>
          <p className="text-[#a0a0a0] mb-8 max-w-md mx-auto leading-relaxed">
            {joinToken ? strings.dev.join.gate : strings.dev.gate.message}
          </p>
          <button onClick={onLogin} className="bg-white text-black px-6 py-3 rounded-lg hover:bg-[#e5e5e5] text-sm transition-colors">
            {strings.dev.gate.login}
          </button>
        </div>
      </Shell>
    );
  }

  const tabs = [['docs', strings.dev.tabs.docs], ['apps', strings.dev.tabs.apps], ['wizard', strings.dev.tabs.wizard]];

  return (
    <Shell>
      <div className="mb-8">
        <h1 className="text-3xl text-white tracking-tight mb-2">{strings.dev.title}</h1>
        <p className="text-[#a0a0a0]">{strings.dev.subtitle}</p>
      </div>

      <div className="inline-flex gap-1 p-1 bg-[#1a1a1a] border border-[#333] rounded-lg mb-8">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              tab === id ? 'bg-[#222] text-white' : 'text-[#808080] hover:text-[#d4d4d4]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'docs' && <DocsTab onWizard={() => setTab('wizard')} />}
      {tab === 'apps' && (
        <div className="max-w-2xl">
        <AppsTab
          apps={apps} loadingApps={loadingApps} showCreate={showCreate} setShowCreate={setShowCreate}
          name={name} setName={setName} website={website} setWebsite={setWebsite}
          redirects={redirects} setRedirects={setRedirects} scopes={scopes} toggleScope={toggleScope}
          creating={creating} createError={createError} createApp={createApp}
          reload={loadApps} username={username}
          newSecret={newSecret} dismissSecret={() => setNewSecret(null)}
          goWizard={() => setTab('wizard')}
        />
        </div>
      )}
      {tab === 'wizard' && (
        <div className="max-w-2xl">
        <WizardTab
          apps={apps} wizStep={wizStep} setWizStep={setWizStep}
          wizAppId={wizAppId} setWizAppId={setWizAppId} wizLang={wizLang} setWizLang={setWizLang}
          goApps={() => setTab('apps')}
        />
        </div>
      )}

      {joinToken && <JoinModal token={joinToken} onClose={dismissJoin} onJoined={onJoined} />}
    </Shell>
  );
}

// Onboarding modal shown when a user opens an invite link (/dev?join=<token>).
function JoinModal({ token, onClose, onJoined }) {
  const j = strings.dev.join;
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/oauth/invites/${encodeURIComponent(token)}`, { credentials: 'include' });
        const data = await res.json();
        if (!alive) return;
        if (res.ok) setInvite(data);
        else setError(data.error || j.invalid);
      } catch { if (alive) setError(j.invalid); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [token]);

  const accept = async () => {
    setAccepting(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/oauth/invites/${encodeURIComponent(token)}/accept`, {
        method: 'POST', credentials: 'include'
      });
      const data = await res.json();
      if (res.ok) onJoined();
      else setError(data.error || j.invalid);
    } catch { setError(j.invalid); }
    finally { setAccepting(false); }
  };

  return (
    <Modal title={loading ? j.title : (invite ? j.heading(invite.app_name) : j.title)} onClose={onClose}>
      {loading ? (
        <p className="text-sm text-[#808080]">{strings.dev.loading}</p>
      ) : !invite ? (
        <>
          <p className="text-sm text-red-400 mb-5">{error || j.invalid}</p>
          <button onClick={onClose} className="w-full border border-[#333] text-[#d4d4d4] px-4 py-2.5 rounded-lg hover:bg-[#222] text-sm transition-colors">
            {strings.dev.apps.access.close}
          </button>
        </>
      ) : invite.is_owner ? (
        <>
          <p className="text-sm text-[#a0a0a0] mb-5">{j.isOwner}</p>
          <button onClick={onJoined} className="w-full bg-white text-black px-4 py-2.5 rounded-lg hover:bg-[#e5e5e5] text-sm transition-colors">
            {strings.dev.apps.access.close}
          </button>
        </>
      ) : invite.already_member ? (
        <>
          <p className="text-sm text-[#a0a0a0] mb-5">{j.alreadyMember}</p>
          <button onClick={onJoined} className="w-full bg-white text-black px-4 py-2.5 rounded-lg hover:bg-[#e5e5e5] text-sm transition-colors">
            {strings.dev.apps.access.close}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-[#a0a0a0] mb-3 leading-relaxed">{j.body(invite.owner_username, invite.role)}</p>
          <div className="flex items-center gap-2 mb-1">
            <RoleBadge role={invite.role} />
            <span className="text-xs text-[#666]">{j.roleNote[invite.role]}</span>
          </div>
          {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
          <div className="flex gap-3 mt-6">
            <button onClick={accept} disabled={accepting} className="flex-1 bg-white text-black px-4 py-2.5 rounded-lg hover:bg-[#e5e5e5] disabled:opacity-50 text-sm transition-colors">
              {accepting ? j.accepting : j.accept}
            </button>
            <button onClick={onClose} disabled={accepting} className="flex-1 border border-[#333] text-[#d4d4d4] px-4 py-2.5 rounded-lg hover:bg-[#222] disabled:opacity-50 text-sm transition-colors">
              {j.decline}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

const DOC_SECTIONS = ['intro', 'quickstart', 'scopes', 'endpoints', 'delegation', 'tokens', 'encryption'];

function DocsTab({ onWizard }) {
  const d = strings.dev.docs;
  const [active, setActive] = useState('intro');
  const observerRef = useRef(null);

  const navItems = [
    ['intro', d.what.title],
    ['quickstart', d.quickstart.title],
    ['scopes', d.scopes.title],
    ['endpoints', d.endpoints.title],
    ['delegation', d.delegation.title],
    ['tokens', d.tokens.title],
    ['encryption', d.encryption.title]
  ];

  useEffect(() => {
    const els = DOC_SECTIONS.map((id) => document.getElementById(id)).filter(Boolean);
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); });
    }, { rootMargin: '-72px 0px -65% 0px', threshold: 0 });
    els.forEach((el) => obs.observe(el));
    observerRef.current = obs;
    return () => obs.disconnect();
  }, []);

  const quickstartCode = genNode('YOUR_CLIENT_ID', 'https://yourapp.com/callback', 'identity email');

  return (
    <div className="grid md:grid-cols-[180px_minmax(0,1fr)] gap-10 lg:gap-14">
      <nav className="hidden md:block">
        <div className="sticky top-20">
          <div className="text-[11px] uppercase tracking-wider text-[#666] mb-3 px-3">{d.onThisPage}</div>
          <div className="space-y-0.5 border-l border-[#222]">
            {navItems.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                onClick={() => setActive(id)}
                className={`block pl-3 -ml-px py-1.5 border-l text-sm transition-colors ${
                  active === id
                    ? 'border-white text-white'
                    : 'border-transparent text-[#808080] hover:text-[#d4d4d4]'
                }`}
              >
                {label}
              </a>
            ))}
          </div>
        </div>
      </nav>

      <div className="min-w-0 text-sm leading-relaxed space-y-14 pb-20">
        <section id="intro" className="scroll-mt-20">
          <h2 className="text-2xl text-white tracking-tight mb-3">{d.what.title}</h2>
          <p className="text-[#a0a0a0]">{d.what.body}</p>
          <div className="mt-4 rounded-xl border border-[#333] bg-[#1a1a1a] px-4 py-3 text-sm text-[#a0a0a0]">
            {d.specCallout}{' '}
            <a href={d.specUrl} target="_blank" rel="noopener" className="text-blue-400 hover:underline break-all">{d.specUrl}</a>
          </div>
        </section>

        <section id="quickstart" className="scroll-mt-20">
          <h2 className="text-xl text-white tracking-tight mb-3">{d.quickstart.title}</h2>
          <p className="text-[#a0a0a0] mb-5">{d.quickstart.body}</p>
          <ol className="space-y-3 mb-6">
            {d.flow.steps.map((s, i) => (
              <li key={i} className="flex gap-3.5">
                <span className="shrink-0 w-6 h-6 rounded-full bg-[#222] border border-[#333] text-[#d4d4d4] text-xs flex items-center justify-center mt-0.5">{i + 1}</span>
                <span className="text-[#a0a0a0]">{s}</span>
              </li>
            ))}
          </ol>
          <CodeBlock code={quickstartCode} />
          <button onClick={onWizard} className="mt-4 w-full text-left bg-[#1a1a1a] border border-[#333] rounded-xl px-4 py-3 hover:bg-[#222] transition-colors group flex items-center justify-between">
            <span className="text-[#d4d4d4] text-sm">{strings.dev.docs.wizardHint}</span>
            <span className="text-[#666] group-hover:text-white transition-colors">→</span>
          </button>
        </section>

        <section id="scopes" className="scroll-mt-20">
          <h2 className="text-xl text-white tracking-tight mb-4">{d.scopes.title}</h2>
          <div className="bg-[#1a1a1a] border border-[#333] rounded-xl px-5 divide-y divide-[#222]">
            {SCOPE_OPTIONS.map(([id, label]) => (
              <div key={id} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 py-3">
                <code className="text-blue-400 text-xs shrink-0 sm:w-44">{id}</code>
                <span className="text-[#a0a0a0]">{label}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-[#2a3a2a] bg-green-400/5 px-5 py-4">
            <h3 className="text-sm text-green-300 mb-2">{d.scopes.recommendedTitle}</h3>
            <p className="text-[#a0a0a0] text-sm leading-relaxed mb-2">{d.scopes.recommendedBody}</p>
            <code className="block text-green-300/90 text-xs bg-[#0f140f] border border-[#1f2a1f] rounded px-3 py-2 break-all">{d.scopes.recommendedBundle}</code>
            <p className="text-[#666] text-xs mt-2">{d.scopes.recommendedNote}</p>
          </div>
        </section>

        <section id="endpoints" className="scroll-mt-20">
          <h2 className="text-xl text-white tracking-tight mb-4">{d.endpoints.title}</h2>
          <div className="bg-[#1a1a1a] border border-[#333] rounded-xl divide-y divide-[#222]">
            {d.endpoints.list.map(([method, path, desc], i) => (
              <div key={i} className="px-5 py-3 font-mono text-xs">
                <div className="flex items-baseline gap-3">
                  <span className={`font-semibold w-12 shrink-0 ${METHOD_COLOR[method] || 'text-[#a0a0a0]'}`}>{method}</span>
                  <code className="text-[#d4d4d4] break-all">{path}</code>
                </div>
                <div className="text-[#666] pl-[3.75rem] mt-1">{desc}</div>
              </div>
            ))}
          </div>

          <h3 className="text-base text-white tracking-tight mt-8 mb-2">{d.responses.title}</h3>
          <p className="text-[#a0a0a0] mb-3">{d.responses.body}</p>
          <div className="bg-[#1a1a1a] border border-[#333] rounded-xl divide-y divide-[#222]">
            {d.responses.items.map(([path, shape], i) => (
              <div key={i} className="px-4 py-3">
                <code className="text-blue-400 text-xs break-all">{path}</code>
                <pre className="text-[#a0a0a0] text-xs mt-1.5 whitespace-pre-wrap break-all font-mono leading-relaxed">{shape}</pre>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-orange-400/30 bg-orange-400/5 px-5 py-4">
            <h3 className="text-sm text-orange-300 mb-2">{d.gotchas.title}</h3>
            <ul className="space-y-2">
              {d.gotchas.points.map((p, i) => (
                <li key={i} className="flex gap-2.5 text-[#a0a0a0] text-xs leading-relaxed">
                  <span className="text-orange-400/70 shrink-0">⚠</span><span>{p}</span>
                </li>
              ))}
            </ul>
          </div>

          <h3 className="text-base text-white tracking-tight mt-6 mb-2">{d.errors.title}</h3>
          <ul className="space-y-2">
            {d.errors.points.map((p, i) => (
              <li key={i} className="flex gap-2.5 text-[#a0a0a0] text-xs leading-relaxed">
                <span className="text-[#666] shrink-0">—</span><span>{p}</span>
              </li>
            ))}
          </ul>
        </section>

        <section id="delegation" className="scroll-mt-20">
          <h2 className="text-xl text-white tracking-tight mb-3">{d.delegation.title}</h2>
          <p className="text-[#a0a0a0] mb-4">{d.delegation.body}</p>
          <ol className="space-y-3 mb-6">
            {d.delegation.steps.map((s, i) => (
              <li key={i} className="flex gap-3.5">
                <span className="shrink-0 w-6 h-6 rounded-full bg-[#222] border border-[#333] text-[#d4d4d4] text-xs flex items-center justify-center mt-0.5">{i + 1}</span>
                <span className="text-[#a0a0a0]">{s}</span>
              </li>
            ))}
          </ol>
          <CodeBlock code={DECRYPT_SNIPPET} />
          <h3 className="text-base text-white tracking-tight mt-8 mb-3">{d.delegation.writeTitle}</h3>
          <p className="text-[#a0a0a0] mb-4">{d.delegation.write}</p>
          <CodeBlock code={WRITE_SNIPPET} />
          <p className="text-[#666] text-xs mt-3">{d.delegation.note}</p>

          <h3 className="text-base text-white tracking-tight mt-10 mb-3">{d.delegation.dropTitle}</h3>
          <p className="text-[#a0a0a0] mb-4">{d.delegation.drop}</p>
          <CodeBlock code={DROP_SNIPPET} />
          <ul className="space-y-2 mt-4">
            {d.delegation.dropPoints.map((p, i) => (
              <li key={i} className="flex gap-2.5 text-[#a0a0a0]">
                <span className="text-[#666] shrink-0">—</span><span>{p}</span>
              </li>
            ))}
          </ul>
        </section>

        <section id="tokens" className="scroll-mt-20">
          <h2 className="text-xl text-white tracking-tight mb-3">{d.tokens.title}</h2>
          <ul className="space-y-2">
            {d.tokens.points.map((p, i) => (
              <li key={i} className="flex gap-2.5 text-[#a0a0a0]">
                <span className="text-[#666] shrink-0">—</span><span>{p}</span>
              </li>
            ))}
          </ul>
        </section>

        <section id="encryption" className="scroll-mt-20">
          <h2 className="text-xl text-white tracking-tight mb-3">{d.encryption.title}</h2>
          <p className="text-[#a0a0a0]">{d.encryption.body}</p>
        </section>
      </div>
    </div>
  );
}

function ScopeChecklist({ scopes, toggleScope }) {
  return (
    <div className="space-y-1">
      {SCOPE_OPTIONS.map(([id, label]) => {
        const on = scopes.includes(id);
        return (
          <button
            type="button"
            key={id}
            onClick={() => toggleScope(id)}
            className={`w-full text-left flex items-start gap-3 rounded-lg px-3 py-2.5 border transition-colors ${
              on ? 'border-[#333] bg-[#0a0a0a]' : 'border-transparent hover:bg-[#0a0a0a]'
            }`}
          >
            <span className={`shrink-0 mt-0.5 w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
              on ? 'bg-white text-black border-white' : 'border-[#666] text-transparent'
            }`}>✓</span>
            <span className="text-sm text-[#a0a0a0]">
              <code className="text-blue-400">{id}</code>
              <span className="block text-xs text-[#666] mt-0.5">{label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Section header: small label + count, like a workspace console section.
function SectionHeader({ label, count }) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      <span className="text-[11px] uppercase tracking-wider text-[#666]">{label}</span>
      {count != null && <span className="text-[11px] text-[#444]">{count}</span>}
    </div>
  );
}

// A single copyable credential/value row.
function CopyRow({ label, value, hint }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <button
      onClick={copy}
      className="w-full text-left flex items-center justify-between gap-2 bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 hover:border-[#666] transition-colors group"
      title={hint}
    >
      <span className="min-w-0">
        {label && <span className="block text-[10px] uppercase tracking-wider text-[#555] mb-0.5">{label}</span>}
        <code className="font-mono text-xs text-[#a0a0a0] break-all">{value}</code>
      </span>
      <span className="text-[10px] text-[#666] group-hover:text-white shrink-0">
        {copied ? strings.dev.copied : strings.dev.copy}
      </span>
    </button>
  );
}

function AppCard({ app, onEdit, onManageAccess, onDelete }) {
  const a = strings.dev.apps;
  const isOwner = app.role === 'owner';
  const canEdit = isOwner || app.role === 'editor';
  return (
    <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-5 transition-colors hover:border-[#3a3a3a]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-white truncate">{app.name}</span>
            <RoleBadge role={app.role} />
          </div>
          {app.website ? (
            <a href={app.website} target="_blank" rel="noopener noreferrer" className="text-xs text-[#666] hover:text-blue-400 break-all">{app.website}</a>
          ) : !isOwner && app.owner_username ? (
            <span className="text-xs text-[#666]">{a.sharedBy(app.owner_username)}</span>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
        <CopyRow value={app.client_id} hint={a.copyHint} />
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        {app.scopes.map((s) => <Chip key={s}>{s}</Chip>)}
      </div>
      <div className="text-xs text-[#666] mt-3 break-all">
        {a.redirectsLabel}: {app.redirect_uris.join(', ')}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-[#222]">
        {canEdit && (
          <button onClick={() => onEdit(app)} className="text-xs text-[#d4d4d4] border border-[#333] rounded-lg px-3 py-1.5 hover:bg-[#222] transition-colors">
            {a.edit}
          </button>
        )}
        <button onClick={() => onManageAccess(app)} className="text-xs text-[#d4d4d4] border border-[#333] rounded-lg px-3 py-1.5 hover:bg-[#222] transition-colors">
          {a.manageAccess}
        </button>
        {isOwner && (
          <button onClick={() => onDelete(app)} className="text-xs text-red-400/90 hover:text-red-300 border border-[#3a2222] hover:border-red-400/40 rounded-lg px-3 py-1.5 transition-colors ml-auto">
            {a.delete}
          </button>
        )}
        {!canEdit && (
          <span className="text-[11px] text-[#555] ml-auto">{a.viewOnlyNote}</span>
        )}
      </div>
    </div>
  );
}

function DeleteAppModal({ app, onClose, onDeleted }) {
  const a = strings.dev.apps;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const del = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/oauth/clients/${encodeURIComponent(app.client_id)}`, {
        method: 'DELETE', credentials: 'include'
      });
      if (res.ok) { onDeleted(app.client_id); return; }
      const data = await res.json().catch(() => ({}));
      setError(data.error || strings.dev.apps.access.loadFailed);
    } catch { setError(strings.dev.apps.access.loadFailed); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={a.deleteModal.title} onClose={onClose}>
      <p className="text-sm text-[#a0a0a0] mb-6 leading-relaxed">{a.deleteModal.message(app.name)}</p>
      {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
      <div className="flex gap-3">
        <button onClick={del} disabled={busy} className="flex-1 bg-red-600 text-white px-4 py-2.5 rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm transition-colors">
          {busy ? a.deleteModal.deleting : a.deleteModal.confirm}
        </button>
        <button onClick={onClose} disabled={busy} className="flex-1 border border-[#333] text-[#d4d4d4] px-4 py-2.5 rounded-lg hover:bg-[#222] disabled:opacity-50 text-sm transition-colors">
          {a.deleteModal.cancel}
        </button>
      </div>
    </Modal>
  );
}

function EditAppModal({ app, onClose, onSaved }) {
  const a = strings.dev.apps;
  const [name, setName] = useState(app.name || '');
  const [website, setWebsite] = useState(app.website || '');
  const [redirects, setRedirects] = useState((app.redirect_uris || []).join('\n'));
  const [scopes, setScopes] = useState(app.scopes && app.scopes.length ? app.scopes : ['identity']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggleScope = (s) => setScopes((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    const redirect_uris = redirects.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (!name.trim()) return setError(strings.dev.errors.nameRequired);
    if (redirect_uris.length === 0) return setError(strings.dev.errors.redirectRequired);
    if (scopes.length === 0) return setError(strings.dev.errors.scopeRequired);
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/oauth/clients/${encodeURIComponent(app.client_id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: name.trim(), website: website.trim() || undefined, redirect_uris, scopes })
      });
      const data = await res.json();
      if (res.ok) { onSaved(); return; }
      setError(data.error || strings.dev.errors.createFailed);
    } catch { setError(strings.dev.errors.createFailed); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={a.editTitle} subtitle={app.name} onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={save} className="space-y-4">
        <Field label={a.nameLabel}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={a.namePlaceholder} maxLength={80} className={inputClass} autoFocus />
        </Field>
        <Field label={a.websiteLabel} hint={a.optional}>
          <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder={a.websitePlaceholder} className={inputClass} />
        </Field>
        <Field label={a.redirectsFieldLabel} hint={a.redirectsHint}>
          <textarea value={redirects} onChange={(e) => setRedirects(e.target.value)} placeholder={a.redirectsPlaceholder} rows={2} className={`${inputClass} font-mono`} />
        </Field>
        <div>
          <p className="text-xs text-[#808080] mb-2">{a.scopesLabel}</p>
          <ScopeChecklist scopes={scopes} toggleScope={toggleScope} />
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={busy} className="bg-white text-black px-4 py-2.5 rounded-lg hover:bg-[#e5e5e5] disabled:opacity-50 text-sm transition-colors">
            {busy ? a.saving : a.save}
          </button>
          <button type="button" onClick={onClose} disabled={busy} className="border border-[#333] text-[#d4d4d4] px-4 py-2.5 rounded-lg hover:bg-[#222] disabled:opacity-50 text-sm transition-colors">
            {a.cancel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AccessManager({ app, currentUsername, onClose, onChanged }) {
  const ax = strings.dev.apps.access;
  const isOwner = app.role === 'owner';
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState(null);     // { owner, collaborators, your_role }
  const [invites, setInvites] = useState([]);
  const [error, setError] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [creatingLink, setCreatingLink] = useState(false);
  const [busyUser, setBusyUser] = useState(null);
  const [busyToken, setBusyToken] = useState(null);
  const [copiedToken, setCopiedToken] = useState(null);

  const inviteUrl = (token) => `${origin}/dev?join=${token}`;

  const load = async () => {
    try {
      const res = await fetch(`${API_URL}/oauth/clients/${encodeURIComponent(app.client_id)}/collaborators`, { credentials: 'include' });
      const data = await res.json();
      if (res.ok) setTeam(data); else setError(data.error || ax.loadFailed);
      if (isOwner) {
        const ir = await fetch(`${API_URL}/oauth/clients/${encodeURIComponent(app.client_id)}/invites`, { credentials: 'include' });
        const idata = await ir.json();
        if (ir.ok) setInvites(Array.isArray(idata) ? idata : []);
      }
    } catch { setError(ax.loadFailed); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const createLink = async () => {
    setCreatingLink(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/oauth/clients/${encodeURIComponent(app.client_id)}/invites`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ role: inviteRole })
      });
      const data = await res.json();
      if (res.ok) setInvites((prev) => [{ token: data.token, role: data.role, expires_at: data.expires_at }, ...prev]);
      else setError(data.error || ax.loadFailed);
    } catch { setError(ax.loadFailed); }
    finally { setCreatingLink(false); }
  };

  const copyLink = (token) => {
    navigator.clipboard?.writeText(inviteUrl(token)).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 1500);
    }).catch(() => {});
  };

  const revokeLink = async (token) => {
    setBusyToken(token);
    try {
      const res = await fetch(`${API_URL}/oauth/clients/${encodeURIComponent(app.client_id)}/invites/${encodeURIComponent(token)}`, {
        method: 'DELETE', credentials: 'include'
      });
      if (res.ok) setInvites((prev) => prev.filter((i) => i.token !== token));
    } catch { /* ignore */ }
    finally { setBusyToken(null); }
  };

  const removeMember = async (userId) => {
    setBusyUser(userId);
    try {
      const res = await fetch(`${API_URL}/oauth/clients/${encodeURIComponent(app.client_id)}/collaborators/${userId}`, {
        method: 'DELETE', credentials: 'include'
      });
      if (res.ok) {
        // if we removed ourselves, our access is gone — close + refresh the list.
        if (!isOwner) { onChanged(); onClose(); return; }
        setTeam((t) => ({ ...t, collaborators: t.collaborators.filter((c) => c.user_id !== userId) }));
        onChanged();
      }
    } catch { /* ignore */ }
    finally { setBusyUser(null); }
  };

  return (
    <Modal title={ax.title} subtitle={ax.subtitle(app.name)} onClose={onClose} maxWidth="max-w-lg">
      {loading ? (
        <p className="text-sm text-[#808080]">{strings.dev.loading}</p>
      ) : (
        <div className="space-y-6">
          {/* team */}
          <div>
            <SectionHeader label={ax.membersHeading} />
            <div className="space-y-1.5">
              {team?.owner && (
                <MemberRow
                  username={team.owner.username} role="owner"
                  isYou={team.owner.username === currentUsername}
                />
              )}
              {(team?.collaborators || []).map((c) => (
                <MemberRow
                  key={c.user_id} username={c.username} role={c.role}
                  isYou={c.username === currentUsername}
                  onRemove={(isOwner || c.username === currentUsername) ? () => removeMember(c.user_id) : null}
                  removing={busyUser === c.user_id}
                  removeLabel={c.username === currentUsername ? ax.leave : ax.remove}
                />
              ))}
              {(!team?.collaborators || team.collaborators.length === 0) && (
                <p className="text-xs text-[#666] py-1">{ax.empty}</p>
              )}
            </div>
          </div>

          {/* invite links (owner only) */}
          {isOwner ? (
            <div className="pt-2 border-t border-[#222]">
              <SectionHeader label={ax.inviteHeading} />
              <p className="text-xs text-[#666] mb-3 leading-relaxed">{ax.inviteBody}</p>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-[#808080] shrink-0">{ax.inviteRoleLabel}</span>
                <div className="inline-flex gap-1 p-1 bg-[#0a0a0a] border border-[#333] rounded-lg">
                  {['editor', 'viewer'].map((r) => (
                    <button key={r} onClick={() => setInviteRole(r)}
                      className={`px-3 py-1 text-xs rounded-md transition-colors ${inviteRole === r ? 'bg-[#222] text-white' : 'text-[#808080] hover:text-[#d4d4d4]'}`}>
                      {r === 'editor' ? ax.roleEditor : ax.roleViewer}
                    </button>
                  ))}
                </div>
                <button onClick={createLink} disabled={creatingLink}
                  className="ml-auto text-xs bg-white text-black px-3 py-1.5 rounded-lg hover:bg-[#e5e5e5] disabled:opacity-50 transition-colors shrink-0">
                  {creatingLink ? ax.creatingLink : ax.createLink}
                </button>
              </div>
              {invites.length === 0 ? (
                <p className="text-xs text-[#555]">{ax.noLinks}</p>
              ) : (
                <div className="space-y-2">
                  {invites.map((inv) => (
                    <div key={inv.token} className="bg-[#0a0a0a] border border-[#333] rounded-lg p-2.5">
                      <div className="flex items-center gap-2 mb-2">
                        <RoleBadge role={inv.role} />
                        <span className="text-[11px] text-[#666]">{ax.linkRole(inv.role)}</span>
                        <button onClick={() => revokeLink(inv.token)} disabled={busyToken === inv.token}
                          className="ml-auto text-[11px] text-red-400/80 hover:text-red-300 disabled:opacity-50 transition-colors">
                          {busyToken === inv.token ? ax.revoking : ax.revokeLink}
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 min-w-0 truncate text-[11px] text-[#808080] font-mono">{inviteUrl(inv.token)}</code>
                        <button onClick={() => copyLink(inv.token)}
                          className="text-[11px] px-2 py-1 rounded-md bg-[#1a1a1a] border border-[#333] text-[#a0a0a0] hover:text-white transition-colors shrink-0">
                          {copiedToken === inv.token ? ax.copiedLink : ax.copyLink}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-[#555] pt-2 border-t border-[#222]">{ax.ownerOnly}</p>
          )}

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex justify-end">
            <button onClick={onClose} className="text-sm border border-[#333] text-[#d4d4d4] px-4 py-2 rounded-lg hover:bg-[#222] transition-colors">
              {ax.close}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function MemberRow({ username, role, isYou, onRemove, removing, removeLabel }) {
  const ax = strings.dev.apps.access;
  return (
    <div className="flex items-center gap-3 bg-[#0a0a0a] border border-[#222] rounded-lg px-3 py-2">
      <span className="w-7 h-7 rounded-full bg-[#222] border border-[#333] flex items-center justify-center text-xs text-[#a0a0a0] shrink-0 uppercase">
        {(username || '?')[0]}
      </span>
      <span className="min-w-0">
        <span className="text-sm text-white">@{username}</span>
        {isYou && <span className="text-[11px] text-[#666] ml-1.5">({ax.you})</span>}
      </span>
      <span className="ml-auto flex items-center gap-2 shrink-0">
        <RoleBadge role={role} />
        {onRemove && (
          <button onClick={onRemove} disabled={removing}
            className="text-[11px] text-red-400/80 hover:text-red-300 disabled:opacity-50 transition-colors">
            {removing ? ax.removing : removeLabel}
          </button>
        )}
      </span>
    </div>
  );
}

function AppsTab(p) {
  const a = strings.dev.apps;
  const [editApp, setEditApp] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [accessApp, setAccessApp] = useState(null);

  if (p.loadingApps) {
    return <p className="text-[#666] text-sm">{strings.dev.loading}</p>;
  }

  const owned = p.apps.filter((x) => x.role === 'owner');
  const shared = p.apps.filter((x) => x.role && x.role !== 'owner');
  // keep modal targets in sync with reloaded data
  const liveAccessApp = accessApp && p.apps.find((x) => x.client_id === accessApp.client_id);
  const liveEditApp = editApp && p.apps.find((x) => x.client_id === editApp.client_id);

  return (
    <div className="space-y-8">
      {p.newSecret && (
        <div className="bg-[#1a1a1a] border border-orange-400/40 rounded-xl p-4">
          <div className="text-sm text-white mb-1">{a.secretTitle}</div>
          <div className="text-xs text-[#a0a0a0] mb-3">{a.secretBody}</div>
          <code className="block bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-xs text-orange-400 break-all">{p.newSecret.secret}</code>
          <button onClick={p.dismissSecret} className="mt-3 text-xs text-[#808080] hover:text-white">{a.secretDismiss}</button>
        </div>
      )}

      {/* empty state — no apps at all */}
      {p.apps.length === 0 && !p.showCreate && (
        <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-8 text-center">
          <p className="text-[#a0a0a0] text-sm mb-4">{a.empty}</p>
          <button onClick={() => p.setShowCreate(true)} className="bg-white text-black px-4 py-2 rounded-lg hover:bg-[#e5e5e5] text-sm transition-colors">
            {a.createButton}
          </button>
        </div>
      )}

      {/* owned apps */}
      {(owned.length > 0 || (p.apps.length > 0 && shared.length > 0)) && (
        <section>
          {(owned.length > 0 || shared.length > 0) && <SectionHeader label={a.ownedHeading} count={owned.length || null} />}
          <div className="space-y-4">
            {owned.map((app) => (
              <AppCard key={app.client_id} app={app}
                onEdit={setEditApp} onManageAccess={setAccessApp} onDelete={setDeleteTarget} />
            ))}
          </div>
        </section>
      )}

      {/* shared with you */}
      {shared.length > 0 && (
        <section>
          <SectionHeader label={a.sharedHeading} count={shared.length} />
          <div className="space-y-4">
            {shared.map((app) => (
              <AppCard key={app.client_id} app={app}
                onEdit={setEditApp} onManageAccess={setAccessApp} onDelete={setDeleteTarget} />
            ))}
          </div>
        </section>
      )}

      {/* create */}
      {!p.showCreate ? (
        (p.apps.length > 0) && (
          <div className="flex flex-wrap gap-3">
            <button onClick={() => p.setShowCreate(true)} className="text-sm text-white border border-[#333] rounded-lg px-4 py-2 hover:bg-[#222] transition-colors">
              {a.createButton}
            </button>
            <button onClick={p.goWizard} className="text-sm text-[#a0a0a0] border border-[#333] rounded-lg px-4 py-2 hover:bg-[#222] transition-colors">
              {a.openWizard}
            </button>
          </div>
        )
      ) : (
        <form onSubmit={p.createApp} className="bg-[#1a1a1a] border border-[#333] rounded-xl p-5 space-y-4">
          <Field label={a.nameLabel}>
            <input type="text" value={p.name} onChange={(e) => p.setName(e.target.value)} placeholder={a.namePlaceholder} maxLength={80} className={inputClass} autoFocus />
          </Field>
          <Field label={a.websiteLabel} hint={a.optional}>
            <input type="text" value={p.website} onChange={(e) => p.setWebsite(e.target.value)} placeholder={a.websitePlaceholder} className={inputClass} />
          </Field>
          <Field label={a.redirectsFieldLabel} hint={a.redirectsHint}>
            <textarea value={p.redirects} onChange={(e) => p.setRedirects(e.target.value)} placeholder={a.redirectsPlaceholder} rows={2} className={`${inputClass} font-mono`} />
          </Field>
          <div>
            <p className="text-xs text-[#808080] mb-2">{a.scopesLabel}</p>
            <ScopeChecklist scopes={p.scopes} toggleScope={p.toggleScope} />
          </div>
          {p.createError && <p className="text-red-400 text-xs">{p.createError}</p>}
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={p.creating} className="bg-white text-black px-4 py-2 rounded-lg hover:bg-[#e5e5e5] disabled:opacity-50 text-sm transition-colors">
              {p.creating ? a.creating : a.create}
            </button>
            <button type="button" onClick={() => p.setShowCreate(false)} className="border border-[#333] text-[#d4d4d4] px-4 py-2 rounded-lg hover:bg-[#222] text-sm transition-colors">
              {a.cancel}
            </button>
          </div>
        </form>
      )}

      {/* modals */}
      {liveEditApp && (
        <EditAppModal app={liveEditApp} onClose={() => setEditApp(null)}
          onSaved={() => { setEditApp(null); p.reload(); }} />
      )}
      {deleteTarget && (
        <DeleteAppModal app={deleteTarget} onClose={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); p.reload(); }} />
      )}
      {liveAccessApp && (
        <AccessManager app={liveAccessApp} currentUsername={p.username}
          onClose={() => setAccessApp(null)} onChanged={p.reload} />
      )}
    </div>
  );
}

function Stepper({ step, labels, onJump }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {labels.map((label, i) => {
        const n = i + 1;
        const state = n < step ? 'done' : n === step ? 'current' : 'future';
        return (
          <React.Fragment key={n}>
            <button
              onClick={() => n < step && onJump(n)}
              disabled={n >= step}
              className={`flex items-center gap-2 ${n < step ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs border transition-colors ${
                state === 'done' ? 'bg-white text-black border-white'
                  : state === 'current' ? 'border-white text-white'
                  : 'border-[#333] text-[#666]'
              }`}>{n}</span>
              <span className={`text-xs ${state === 'future' ? 'text-[#666]' : 'text-[#d4d4d4]'}`}>{label}</span>
            </button>
            {n < labels.length && <span className="flex-1 h-px bg-[#333]" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function WizardTab(p) {
  const w = strings.dev.wizard;
  const selectedApp = p.apps.find((a) => a.client_id === p.wizAppId);

  return (
    <div>
      <Stepper step={p.wizStep} labels={w.stepLabels} onJump={p.setWizStep} />

      {p.wizStep === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg text-white">{w.step1.title}</h2>
            <p className="text-[#a0a0a0] text-sm mt-1">{w.step1.body}</p>
          </div>
          {p.apps.length === 0 ? (
            <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-5 text-sm text-[#a0a0a0]">
              {w.step1.noApps} <button onClick={p.goApps} className="text-white underline hover:text-blue-400">{w.step1.goCreate}</button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {p.apps.map((a) => (
                <button key={a.client_id} onClick={() => { p.setWizAppId(a.client_id); p.setWizStep(2); }}
                  className={`w-full text-left bg-[#1a1a1a] border rounded-xl p-4 hover:border-[#666] transition-colors ${p.wizAppId === a.client_id ? 'border-white' : 'border-[#333]'}`}>
                  <div className="text-white text-sm">{a.name}</div>
                  <div className="font-mono text-xs text-[#666] mt-1 break-all">{a.client_id}</div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {a.scopes.map((s) => <Chip key={s}>{s}</Chip>)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {p.wizStep === 2 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg text-white">{w.step2.title}</h2>
            <p className="text-[#a0a0a0] text-sm mt-1">{w.step2.body}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {LANGUAGES.map(([id, label, desc]) => (
              <button key={id} onClick={() => { p.setWizLang(id); p.setWizStep(3); }}
                className={`text-left bg-[#1a1a1a] border rounded-xl p-4 hover:border-[#666] transition-colors ${p.wizLang === id ? 'border-white' : 'border-[#333]'}`}>
                <div className="text-white text-sm">{label}</div>
                <div className="text-xs text-[#666] mt-1">{desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {p.wizStep === 3 && (() => {
        const redirectUri = selectedApp?.redirect_uris?.[0] || 'https://yourapp.com/callback';
        const scopeStr = (selectedApp?.scopes || ['identity']).join(' ');
        const code = (GENERATORS[p.wizLang] || genNode)(selectedApp?.client_id || 'jt_xxx', redirectUri, scopeStr);
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg text-white">{w.step3.title}</h2>
              <p className="text-[#a0a0a0] text-sm mt-1">{w.step3.body}</p>
            </div>
            <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-4 text-sm space-y-2">
              <div className="flex justify-between gap-3">
                <span className="text-[#666]">{w.step3.appLabel}</span>
                <span className="text-white">{selectedApp?.name}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[#666]">{strings.dev.apps.redirectsLabel}</span>
                <span className="text-[#a0a0a0] break-all text-right">{redirectUri}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[#666]">{strings.dev.apps.scopesLabel}</span>
                <span className="text-[#a0a0a0] break-all text-right">{scopeStr}</span>
              </div>
            </div>
            <CodeBlock code={code} />
            <p className="text-[#666] text-xs">{w.step3.note}</p>
          </div>
        );
      })()}
    </div>
  );
}
