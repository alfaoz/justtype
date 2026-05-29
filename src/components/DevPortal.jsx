import React, { useState, useEffect } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';

const SCOPE_OPTIONS = [
  ['identity', strings.dev.scopes.identity],
  ['email', strings.dev.scopes.email],
  ['slates:read:public', strings.dev.scopes.public],
  ['slates:read:meta', strings.dev.scopes.meta],
  ['slates:read:private', strings.dev.scopes.private]
];

const LANGUAGES = [
  ['node', 'node / express'],
  ['browser', 'browser (spa)'],
  ['python', 'python / flask'],
  ['curl', 'curl']
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

function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <div className="relative group">
      <button
        onClick={copy}
        className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-[#222] text-[#aaa] hover:text-white border border-[#333] z-10"
      >
        {copied ? strings.dev.copied : strings.dev.copy}
      </button>
      <pre className="bg-[#0d0d0d] border border-[#222] rounded-lg p-4 overflow-x-auto text-xs leading-relaxed text-[#d0d0d0] font-mono whitespace-pre">{code}</pre>
    </div>
  );
}

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

  const Shell = ({ children }) => (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e0e0e0] overflow-y-auto">
      <div className="border-b border-[#1c1c1c]">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="text-sm text-[#888] hover:text-white">← justtype</a>
          <span className="text-sm text-[#666]">{strings.dev.title}</span>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-4 py-8">{children}</div>
    </div>
  );

  if (!token) {
    return (
      <Shell>
        <div className="text-center py-20">
          <h1 className="text-2xl mb-3 text-white">{strings.dev.title}</h1>
          <p className="text-[#888] mb-8 max-w-md mx-auto">{strings.dev.gate.message}</p>
          <button onClick={onLogin} className="bg-white text-black px-6 py-3 rounded-lg hover:bg-[#e5e5e5] text-sm">
            {strings.dev.gate.login}
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-2xl text-white mb-1">{strings.dev.title}</h1>
      <p className="text-[#888] text-sm mb-6">{strings.dev.subtitle}</p>

      <div className="flex gap-1 border-b border-[#1c1c1c] mb-8">
        {[['docs', strings.dev.tabs.docs], ['apps', strings.dev.tabs.apps], ['wizard', strings.dev.tabs.wizard]].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${tab === id ? 'border-white text-white' : 'border-transparent text-[#777] hover:text-[#aaa]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'docs' && <DocsTab />}
      {tab === 'apps' && (
        <AppsTab
          apps={apps} loadingApps={loadingApps} showCreate={showCreate} setShowCreate={setShowCreate}
          name={name} setName={setName} website={website} setWebsite={setWebsite}
          redirects={redirects} setRedirects={setRedirects} scopes={scopes} toggleScope={toggleScope}
          creating={creating} createError={createError} createApp={createApp}
          deleting={deleting} deleteApp={deleteApp} copyId={copyId} copiedId={copiedId}
          goWizard={() => setTab('wizard')}
        />
      )}
      {tab === 'wizard' && (
        <WizardTab
          apps={apps} wizStep={wizStep} setWizStep={setWizStep}
          wizAppId={wizAppId} setWizAppId={setWizAppId} wizLang={wizLang} setWizLang={setWizLang}
          goApps={() => setTab('apps')}
        />
      )}
    </Shell>
  );
}

function DocsTab() {
  const d = strings.dev.docs;
  return (
    <div className="space-y-8 text-sm leading-relaxed">
      <section>
        <h2 className="text-lg text-white mb-2">{d.what.title}</h2>
        <p className="text-[#aaa]">{d.what.body}</p>
      </section>

      <section className="bg-[#141414] border border-[#262626] rounded-lg p-4">
        <h2 className="text-white mb-2">{d.encryption.title}</h2>
        <p className="text-[#999]">{d.encryption.body}</p>
      </section>

      <section>
        <h2 className="text-lg text-white mb-3">{d.scopes.title}</h2>
        <div className="space-y-2">
          {SCOPE_OPTIONS.map(([id, label]) => (
            <div key={id} className="flex gap-3">
              <code className="text-[#7dd3fc] shrink-0">{id}</code>
              <span className="text-[#999]">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg text-white mb-3">{d.flow.title}</h2>
        <ol className="list-decimal list-inside space-y-1 text-[#aaa]">
          {d.flow.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </section>

      <section>
        <h2 className="text-lg text-white mb-3">{d.endpoints.title}</h2>
        <div className="space-y-2 font-mono text-xs">
          {d.endpoints.list.map(([method, path, desc], i) => (
            <div key={i} className="flex flex-wrap gap-x-3 gap-y-0.5">
              <span className="text-[#4ade80] w-12 shrink-0">{method}</span>
              <span className="text-[#d0d0d0]">{path}</span>
              <span className="text-[#777] w-full pl-12">{desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg text-white mb-2">{d.tokens.title}</h2>
        <ul className="list-disc list-inside space-y-1 text-[#aaa]">
          {d.tokens.points.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      </section>

      <p className="text-[#666] text-xs">{strings.dev.docs.wizardHint}</p>
    </div>
  );
}

function ScopeChecklist({ scopes, toggleScope }) {
  return (
    <div className="space-y-1.5">
      {SCOPE_OPTIONS.map(([id, label]) => (
        <label key={id} className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={scopes.includes(id)}
            onChange={() => toggleScope(id)}
            className="w-4 h-4 mt-0.5 rounded border-[#666] bg-[#111] text-blue-500 focus:ring-0"
          />
          <span className="text-[#a0a0a0]"><code className="text-[#7dd3fc]">{id}</code> — {label}</span>
        </label>
      ))}
    </div>
  );
}

function AppsTab(p) {
  return (
    <div className="space-y-4">
      {p.loadingApps ? (
        <p className="text-[#666] text-sm">{strings.dev.loading}</p>
      ) : (
        <>
          {p.apps.length === 0 && !p.showCreate && (
            <p className="text-[#888] text-sm">{strings.dev.apps.empty}</p>
          )}
          {p.apps.map((app) => (
            <div key={app.client_id} className="bg-[#111] border border-[#222] rounded-lg p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-white">{app.name}</span>
                <button
                  onClick={() => p.deleteApp(app.client_id)}
                  disabled={p.deleting === app.client_id}
                  className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50"
                >
                  {p.deleting === app.client_id ? strings.dev.apps.deleting : strings.dev.apps.delete}
                </button>
              </div>
              <button
                onClick={() => p.copyId(app.client_id)}
                className="mt-1 font-mono text-xs text-[#888] hover:text-white break-all text-left"
                title={strings.dev.apps.copyHint}
              >
                {app.client_id}{p.copiedId === app.client_id ? `  ${strings.dev.copied}` : ''}
              </button>
              <div className="text-xs text-[#666] mt-2">{strings.dev.apps.scopesLabel}: {app.scopes.join(', ')}</div>
              <div className="text-xs text-[#666] mt-0.5 break-all">{strings.dev.apps.redirectsLabel}: {app.redirect_uris.join(', ')}</div>
            </div>
          ))}

          {!p.showCreate ? (
            <div className="flex gap-3">
              <button onClick={() => { p.setShowCreate(true); }} className="text-sm text-white border border-[#333] rounded-lg px-4 py-2 hover:bg-[#1a1a1a]">
                {strings.dev.apps.createButton}
              </button>
              {p.apps.length > 0 && (
                <button onClick={p.goWizard} className="text-sm text-[#aaa] border border-[#333] rounded-lg px-4 py-2 hover:bg-[#1a1a1a]">
                  {strings.dev.apps.openWizard}
                </button>
              )}
            </div>
          ) : (
            <form onSubmit={p.createApp} className="bg-[#111] border border-[#222] rounded-lg p-4 space-y-3">
              <input type="text" value={p.name} onChange={(e) => p.setName(e.target.value)} placeholder={strings.dev.apps.namePlaceholder} maxLength={80}
                className="w-full bg-[#0d0d0d] border border-[#333] rounded px-3 py-2 focus:outline-none focus:border-[#666] text-white text-sm" />
              <input type="text" value={p.website} onChange={(e) => p.setWebsite(e.target.value)} placeholder={strings.dev.apps.websitePlaceholder}
                className="w-full bg-[#0d0d0d] border border-[#333] rounded px-3 py-2 focus:outline-none focus:border-[#666] text-white text-sm" />
              <textarea value={p.redirects} onChange={(e) => p.setRedirects(e.target.value)} placeholder={strings.dev.apps.redirectsPlaceholder} rows={2}
                className="w-full bg-[#0d0d0d] border border-[#333] rounded px-3 py-2 focus:outline-none focus:border-[#666] text-white text-sm font-mono" />
              <div>
                <p className="text-xs text-[#666] mb-2">{strings.dev.apps.scopesLabel}</p>
                <ScopeChecklist scopes={p.scopes} toggleScope={p.toggleScope} />
              </div>
              {p.createError && <p className="text-red-400 text-xs">{p.createError}</p>}
              <div className="flex gap-3">
                <button type="submit" disabled={p.creating} className="bg-white text-black px-4 py-2 rounded hover:bg-[#e5e5e5] disabled:opacity-50 text-sm">
                  {p.creating ? strings.dev.apps.creating : strings.dev.apps.create}
                </button>
                <button type="button" onClick={() => { p.setShowCreate(false); }} className="border border-[#333] text-white px-4 py-2 rounded hover:bg-[#333] text-sm">
                  {strings.dev.apps.cancel}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}

function WizardTab(p) {
  const w = strings.dev.wizard;
  const selectedApp = p.apps.find((a) => a.client_id === p.wizAppId);

  // Step 1: pick an app
  if (p.wizStep === 1) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg text-white">{w.step1.title}</h2>
        <p className="text-[#888] text-sm">{w.step1.body}</p>
        {p.apps.length === 0 ? (
          <div className="bg-[#111] border border-[#222] rounded-lg p-4 text-sm text-[#888]">
            {w.step1.noApps} <button onClick={p.goApps} className="text-white underline">{w.step1.goCreate}</button>
          </div>
        ) : (
          <div className="space-y-2">
            {p.apps.map((a) => (
              <button key={a.client_id} onClick={() => { p.setWizAppId(a.client_id); p.setWizStep(2); }}
                className={`w-full text-left bg-[#111] border rounded-lg p-3 hover:border-[#555] ${p.wizAppId === a.client_id ? 'border-white' : 'border-[#222]'}`}>
                <div className="text-white text-sm">{a.name}</div>
                <div className="font-mono text-xs text-[#666] mt-0.5">{a.client_id}</div>
                <div className="text-xs text-[#666] mt-1">{a.scopes.join(', ')}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Step 2: pick language
  if (p.wizStep === 2) {
    return (
      <div className="space-y-4">
        <button onClick={() => p.setWizStep(1)} className="text-xs text-[#888] hover:text-white">{w.back}</button>
        <h2 className="text-lg text-white">{w.step2.title}</h2>
        <div className="grid grid-cols-2 gap-3">
          {LANGUAGES.map(([id, label]) => (
            <button key={id} onClick={() => { p.setWizLang(id); p.setWizStep(3); }}
              className={`bg-[#111] border rounded-lg p-4 text-sm hover:border-[#555] ${p.wizLang === id ? 'border-white text-white' : 'border-[#222] text-[#aaa]'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Step 3: generated code
  const redirectUri = selectedApp?.redirect_uris?.[0] || 'https://yourapp.com/callback';
  const scopeStr = (selectedApp?.scopes || ['identity']).join(' ');
  const code = (GENERATORS[p.wizLang] || genNode)(selectedApp?.client_id || 'jt_xxx', redirectUri, scopeStr);

  return (
    <div className="space-y-4">
      <button onClick={() => p.setWizStep(2)} className="text-xs text-[#888] hover:text-white">{w.back}</button>
      <h2 className="text-lg text-white">{w.step3.title}</h2>
      <div className="text-sm text-[#888] space-y-1">
        <div>{w.step3.appLabel}: <span className="text-white">{selectedApp?.name}</span></div>
        <div className="break-all">{strings.dev.apps.redirectsLabel}: <span className="text-[#aaa]">{redirectUri}</span></div>
        <div>{strings.dev.apps.scopesLabel}: <span className="text-[#aaa]">{scopeStr}</span></div>
      </div>
      <p className="text-[#999] text-sm">{w.step3.body}</p>
      <CodeBlock code={code} />
      <p className="text-[#666] text-xs">{w.step3.note}</p>
    </div>
  );
}
