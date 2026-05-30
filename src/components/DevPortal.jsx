import React, { useState, useEffect, useRef } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';
import { generateAppKeyPair } from '../crypto';

const SCOPE_OPTIONS = [
  ['identity', strings.dev.scopes.identity],
  ['email', strings.dev.scopes.email],
  ['slates:read:public', strings.dev.scopes.public],
  ['slates:read:meta', strings.dev.scopes.meta],
  ['slates:read:private', strings.dev.scopes.private],
  ['slates:write', strings.dev.scopes.write],
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
const PRIVATE_KEY = process.env.JT_PRIVATE_KEY;   // the PEM justtype showed you once
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

const METHOD_COLOR = { GET: 'text-green-400', POST: 'text-blue-400', DELETE: 'text-red-400', PUT: 'text-orange-400' };

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
  const [deleting, setDeleting] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [newSecret, setNewSecret] = useState(null);
  const [newKey, setNewKey] = useState(null);

  // wizard
  const [wizStep, setWizStep] = useState(1);
  const [wizAppId, setWizAppId] = useState('');
  const [wizLang, setWizLang] = useState('node');

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
      // Private-slate access uses key delegation: generate an RSA keypair in the
      // browser, register the public key, and hand the private key to the dev once.
      let public_key, privateKeyPem;
      if (scopes.includes('slates:read:private')) {
        const kp = await generateAppKeyPair();
        public_key = kp.publicKeySpkiBase64;
        privateKeyPem = kp.privateKeyPem;
      }
      const res = await fetch(`${API_URL}/oauth/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: name.trim(), website: website.trim() || undefined, redirect_uris, scopes, public_key })
      });
      const data = await res.json();
      if (res.ok) {
        setShowCreate(false);
        setName(''); setWebsite(''); setRedirects(''); setScopes(['identity']);
        if (data.client_secret) setNewSecret({ id: data.client_id, secret: data.client_secret });
        if (privateKeyPem) setNewKey({ id: data.client_id, pem: privateKeyPem });
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

  const deleteApp = async (clientId) => {
    setDeleting(clientId);
    try {
      const res = await fetch(`${API_URL}/oauth/clients/${encodeURIComponent(clientId)}`, {
        method: 'DELETE', credentials: 'include'
      });
      if (res.ok) setApps((a) => a.filter((x) => x.client_id !== clientId));
    } catch { /* ignore */ }
    finally { setDeleting(null); }
  };

  const copyId = (id) => {
    navigator.clipboard?.writeText(id).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    }).catch(() => {});
  };

  if (!token) {
    return (
      <Shell>
        <div className="text-center py-24">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#1a1a1a] border border-[#333] mb-6 text-xl">{'</>'}</div>
          <h1 className="text-2xl text-white mb-3">{strings.dev.title}</h1>
          <p className="text-[#a0a0a0] mb-8 max-w-md mx-auto leading-relaxed">{strings.dev.gate.message}</p>
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
          deleting={deleting} deleteApp={deleteApp} copyId={copyId} copiedId={copiedId}
          newSecret={newSecret} dismissSecret={() => setNewSecret(null)}
          newKey={newKey} dismissKey={() => setNewKey(null)}
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
    </Shell>
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

function AppsTab(p) {
  if (p.loadingApps) {
    return <p className="text-[#666] text-sm">{strings.dev.loading}</p>;
  }
  return (
    <div className="space-y-4">
      {p.newSecret && (
        <div className="bg-[#1a1a1a] border border-orange-400/40 rounded-xl p-4">
          <div className="text-sm text-white mb-1">{strings.dev.apps.secretTitle}</div>
          <div className="text-xs text-[#a0a0a0] mb-3">{strings.dev.apps.secretBody}</div>
          <code className="block bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-xs text-orange-400 break-all">{p.newSecret.secret}</code>
          <button onClick={p.dismissSecret} className="mt-3 text-xs text-[#808080] hover:text-white">{strings.dev.apps.secretDismiss}</button>
        </div>
      )}

      {p.newKey && (
        <div className="bg-[#1a1a1a] border border-orange-400/40 rounded-xl p-4">
          <div className="text-sm text-white mb-1">{strings.dev.apps.keyTitle}</div>
          <div className="text-xs text-[#a0a0a0] mb-3">{strings.dev.apps.keyBody}</div>
          <pre className="bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-[10px] leading-relaxed text-orange-400 overflow-x-auto whitespace-pre">{p.newKey.pem}</pre>
          <div className="flex gap-3 mt-3">
            <button
              onClick={() => navigator.clipboard?.writeText(p.newKey.pem).catch(() => {})}
              className="text-xs text-[#808080] hover:text-white"
            >{strings.dev.copy}</button>
            <a
              href={`data:application/x-pem-file;charset=utf-8,${encodeURIComponent(p.newKey.pem)}`}
              download={`${p.newKey.id}-private-key.pem`}
              className="text-xs text-[#808080] hover:text-white"
            >{strings.dev.apps.keyDownload}</a>
            <button onClick={p.dismissKey} className="text-xs text-[#808080] hover:text-white ml-auto">{strings.dev.apps.secretDismiss}</button>
          </div>
        </div>
      )}

      {p.apps.length === 0 && !p.showCreate && (
        <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-8 text-center">
          <p className="text-[#a0a0a0] text-sm mb-4">{strings.dev.apps.empty}</p>
          <button onClick={() => p.setShowCreate(true)} className="bg-white text-black px-4 py-2 rounded-lg hover:bg-[#e5e5e5] text-sm transition-colors">
            {strings.dev.apps.createButton}
          </button>
        </div>
      )}

      {p.apps.map((app) => (
        <div key={app.client_id} className="bg-[#1a1a1a] border border-[#333] rounded-xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-white">{app.name}</div>
              {app.website && (
                <a href={app.website} target="_blank" rel="noopener noreferrer" className="text-xs text-[#666] hover:text-blue-400 break-all">{app.website}</a>
              )}
            </div>
            <button
              onClick={() => p.deleteApp(app.client_id)}
              disabled={p.deleting === app.client_id}
              className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50 shrink-0"
            >
              {p.deleting === app.client_id ? strings.dev.apps.deleting : strings.dev.apps.delete}
            </button>
          </div>

          <button
            onClick={() => p.copyId(app.client_id)}
            className="mt-3 w-full text-left flex items-center justify-between gap-2 bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 hover:border-[#666] transition-colors group"
            title={strings.dev.apps.copyHint}
          >
            <code className="font-mono text-xs text-[#a0a0a0] break-all">{app.client_id}</code>
            <span className="text-[10px] text-[#666] group-hover:text-white shrink-0">
              {p.copiedId === app.client_id ? strings.dev.copied : strings.dev.copy}
            </span>
          </button>

          <div className="flex flex-wrap gap-1.5 mt-3">
            {app.scopes.map((s) => <Chip key={s}>{s}</Chip>)}
          </div>
          <div className="text-xs text-[#666] mt-3 break-all">
            {strings.dev.apps.redirectsLabel}: {app.redirect_uris.join(', ')}
          </div>
        </div>
      ))}

      {!p.showCreate ? (
        (p.apps.length > 0) && (
          <div className="flex flex-wrap gap-3">
            <button onClick={() => p.setShowCreate(true)} className="text-sm text-white border border-[#333] rounded-lg px-4 py-2 hover:bg-[#222] transition-colors">
              {strings.dev.apps.createButton}
            </button>
            <button onClick={p.goWizard} className="text-sm text-[#a0a0a0] border border-[#333] rounded-lg px-4 py-2 hover:bg-[#222] transition-colors">
              {strings.dev.apps.openWizard}
            </button>
          </div>
        )
      ) : (
        <form onSubmit={p.createApp} className="bg-[#1a1a1a] border border-[#333] rounded-xl p-5 space-y-4">
          <Field label={strings.dev.apps.nameLabel}>
            <input type="text" value={p.name} onChange={(e) => p.setName(e.target.value)} placeholder={strings.dev.apps.namePlaceholder} maxLength={80} className={inputClass} autoFocus />
          </Field>
          <Field label={strings.dev.apps.websiteLabel} hint={strings.dev.apps.optional}>
            <input type="text" value={p.website} onChange={(e) => p.setWebsite(e.target.value)} placeholder={strings.dev.apps.websitePlaceholder} className={inputClass} />
          </Field>
          <Field label={strings.dev.apps.redirectsFieldLabel} hint={strings.dev.apps.redirectsHint}>
            <textarea value={p.redirects} onChange={(e) => p.setRedirects(e.target.value)} placeholder={strings.dev.apps.redirectsPlaceholder} rows={2} className={`${inputClass} font-mono`} />
          </Field>
          <div>
            <p className="text-xs text-[#808080] mb-2">{strings.dev.apps.scopesLabel}</p>
            <ScopeChecklist scopes={p.scopes} toggleScope={p.toggleScope} />
          </div>
          {p.createError && <p className="text-red-400 text-xs">{p.createError}</p>}
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={p.creating} className="bg-white text-black px-4 py-2 rounded-lg hover:bg-[#e5e5e5] disabled:opacity-50 text-sm transition-colors">
              {p.creating ? strings.dev.apps.creating : strings.dev.apps.create}
            </button>
            <button type="button" onClick={() => p.setShowCreate(false)} className="border border-[#333] text-[#d4d4d4] px-4 py-2 rounded-lg hover:bg-[#222] text-sm transition-colors">
              {strings.dev.apps.cancel}
            </button>
          </div>
        </form>
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
