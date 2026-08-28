import { API_URL } from './config';
import {
  decryptContent,
  decryptOwnerGrant,
  decryptTitle,
  encryptContent,
  encryptTitle,
} from './crypto';

const RUN_FLAG = (userId) => `justtype-incident-recovery-v3-${userId}`;
const PENDING_REPORTS = (userId) => `justtype-incident-recovery-reports-v1-${userId}`;
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const DB_NAME = 'justtype-incident-recovery';
const DB_VERSION = 1;
const STORE_NAME = 'records';
const running = new Map();
let recoveryDbPromise = null;

function contentStats(content) {
  return {
    wordCount: content.trim() === '' ? 0 : content.trim().split(/\s+/).length,
    charCount: content.length,
    sizeBytes: new TextEncoder().encode(content).length,
  };
}

function normalizedTime(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export function recoveryContentMatches(slate, content, { e2eMigrated = false, updatedAt = null } = {}) {
  if (!slate || typeof content !== 'string') return false;
  const stats = contentStats(content);
  if (stats.charCount !== Number(slate.char_count)) return false;
  if (stats.wordCount !== Number(slate.word_count)) return false;
  if (!e2eMigrated && Number.isFinite(Number(slate.size_bytes)) && stats.sizeBytes !== Number(slate.size_bytes)) {
    return false;
  }
  const candidateTime = normalizedTime(updatedAt);
  const slateTime = normalizedTime(slate.updated_at);
  return !(candidateTime && slateTime && candidateTime !== slateTime);
}

function openRecoveryDb() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB unavailable'));
  if (recoveryDbPromise) return recoveryDbPromise;
  recoveryDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('by_user', 'user_id', { unique: false });
        store.createIndex('by_slate', ['user_id', 'slate_number'], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open recovery database'));
  });
  return recoveryDbPromise;
}

async function putRecoveryRecord(record) {
  const db = await openRecoveryDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    let isNew = false;
    const getRequest = store.get(record.id);
    getRequest.onsuccess = () => {
      isNew = !getRequest.result;
      store.put(record);
    };
    getRequest.onerror = () => transaction.abort();
    transaction.oncomplete = () => resolve(isNew);
    transaction.onerror = () => reject(transaction.error || new Error('Unable to archive recovery record'));
    transaction.onabort = () => reject(transaction.error || new Error('Recovery archive transaction aborted'));
  });
}

async function getRecoveryRecords(userId) {
  const db = await openRecoveryDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).index('by_user').getAll(Number(userId));
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error || new Error('Unable to read recovery archive'));
  });
}

async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Text(value) {
  return sha256Bytes(new TextEncoder().encode(value));
}

function base64Bytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function archivePlaintext(context, {
  slateNumber = null,
  source,
  title = null,
  content,
  metadata = {},
  includeInBundle = true,
}) {
  const sha256 = await sha256Text(content);
  const record = {
    id: `u${context.userId}:plain:${slateNumber ?? 'draft'}:${sha256}`,
    user_id: Number(context.userId),
    slate_number: slateNumber == null ? null : Number(slateNumber),
    kind: 'plaintext_copy',
    source,
    title,
    content,
    sha256,
    captured_at: new Date().toISOString(),
    metadata,
  };
  const isNew = await putRecoveryRecord(record);
  if (isNew && includeInBundle) context.bundleRecords.push(record);
  return { archived: true, record };
}

async function archiveEncrypted(context, {
  id,
  slateNumber = null,
  source,
  encryptedContent,
  metadata = {},
  includeInBundle = true,
}) {
  const sha256 = await sha256Text(encryptedContent);
  const record = {
    id: `u${context.userId}:encrypted:${id || sha256}`,
    user_id: Number(context.userId),
    slate_number: slateNumber == null ? null : Number(slateNumber),
    kind: 'encrypted_copy',
    source,
    encrypted_content: encryptedContent,
    sha256_of_base64: sha256,
    captured_at: new Date().toISOString(),
    metadata,
  };
  const isNew = await putRecoveryRecord(record);
  if (isNew && includeInBundle) context.bundleRecords.push(record);
  return { archived: true, record };
}

function readRunState(userId) {
  try {
    return JSON.parse(localStorage.getItem(RUN_FLAG(userId)) || 'null');
  } catch {
    return null;
  }
}

function writeRunState(userId, state) {
  try {
    localStorage.setItem(RUN_FLAG(userId), JSON.stringify(state));
  } catch {
    // IndexedDB records remain authoritative if localStorage is unavailable.
  }
}

function readPendingReports(userId) {
  try {
    const reports = JSON.parse(localStorage.getItem(PENDING_REPORTS(userId)) || '[]');
    return Array.isArray(reports) ? reports.filter((receipt) => typeof receipt === 'string') : [];
  } catch {
    return [];
  }
}

function writePendingReports(userId, receipts) {
  try {
    if (receipts.length) localStorage.setItem(PENDING_REPORTS(userId), JSON.stringify([...new Set(receipts)]));
    else localStorage.removeItem(PENDING_REPORTS(userId));
  } catch {
    // The server receipt remains best-effort if localStorage is unavailable.
  }
}

async function deliverRecoveryReport(receipt) {
  try {
    const response = await fetch(`${API_URL}/account/incident-recovery-success`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ receipt }),
    });
    if (response.ok) return 'delivered';
    if (response.status === 400 || response.status === 403) return 'discard';
    return 'retry';
  } catch {
    return 'retry';
  }
}

async function flushPendingReports(userId) {
  const pending = readPendingReports(userId);
  if (!pending.length) return;
  const retry = [];
  for (const receipt of pending) {
    if (await deliverRecoveryReport(receipt) === 'retry') retry.push(receipt);
  }
  writePendingReports(userId, retry);
}

async function reportRecovery(userId, receipt) {
  if (!receipt) {
    console.warn('slate recovery: server did not issue a recovery receipt');
    return;
  }
  if (await deliverRecoveryReport(receipt) === 'retry') {
    writePendingReports(userId, [...readPendingReports(userId), receipt]);
  }
}

async function responseJson(response) {
  if (!response || !response.ok) return null;
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function onlyCachedJson(url) {
  try {
    const absolute = new URL(url, window.location.origin);
    if (absolute.origin !== window.location.origin) return null;
    const response = await fetch(absolute.href, {
      cache: 'only-if-cached',
      mode: 'same-origin',
      credentials: 'include',
    });
    return responseJson(response);
  } catch {
    return null;
  }
}

async function scanCacheStorage() {
  const found = { privateBySlate: new Map(), publicByShare: new Map() };
  if (!('caches' in window)) return found;
  try {
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        if (url.origin !== window.location.origin) continue;
        const privateMatch = url.pathname.match(/^\/api\/slates\/(\d+)\/?$/);
        const publicMatch = url.pathname.match(/^\/api\/public\/slates\/([^/]+)\/?$/);
        if (!privateMatch && !publicMatch) continue;
        const payload = await responseJson(await cache.match(request));
        if (!payload) continue;
        if (privateMatch) {
          const key = Number(privateMatch[1]);
          const values = found.privateBySlate.get(key) || [];
          values.push({ payload, source: `cache-storage:${cacheName}` });
          found.privateBySlate.set(key, values);
        } else {
          const key = decodeURIComponent(publicMatch[1]);
          const values = found.publicByShare.get(key) || [];
          values.push({ payload, source: `cache-storage:${cacheName}` });
          found.publicByShare.set(key, values);
        }
      }
    }
  } catch (error) {
    console.warn('slate recovery: Cache Storage scan failed', error);
  }
  return found;
}

function privatePayloadBelongsTo(payload, userId, slateNumber) {
  return Number(payload?.user_id) === Number(userId)
    && Number(payload?.slate_number) === Number(slateNumber);
}

async function candidateFromPrivatePayload(context, slate, payload, source, includeInBundle = true) {
  if (!privatePayloadBelongsTo(payload, context.userId, slate.slate_number)) return null;
  let content;
  let title = typeof payload.title === 'string' ? payload.title : null;
  if (typeof payload.encryptedContent === 'string') {
    await archiveEncrypted(context, {
      id: `${source}:${slate.slate_number}:${await sha256Text(payload.encryptedContent)}`,
      slateNumber: slate.slate_number,
      source,
      encryptedContent: payload.encryptedContent,
      metadata: { updated_at: payload.updated_at || null, encrypted_title: payload.encrypted_title || null },
      includeInBundle,
    });
    if (!context.masterKey) return null;
    try {
      content = await decryptContent(payload.encryptedContent, context.masterKey);
      const encryptedTitle = payload.encrypted_title || slate.encrypted_title;
      if (encryptedTitle) title = await decryptTitle(encryptedTitle, context.masterKey);
    } catch {
      return null;
    }
  } else if (typeof payload.content === 'string' && !payload.pending) {
    content = payload.content;
  } else {
    return null;
  }
  const archived = await archivePlaintext(context, {
    slateNumber: slate.slate_number,
    source,
    title,
    content,
    metadata: { updated_at: payload.updated_at || null },
    includeInBundle,
  });
  return {
    content,
    title,
    source,
    recoveryType: 'device_cache',
    updatedAt: payload.updated_at || null,
    archived: archived.archived,
  };
}

async function candidateFromPublicPayload(context, slate, payload, source) {
  if (typeof payload?.content !== 'string') return null;
  const archived = await archivePlaintext(context, {
    slateNumber: slate.slate_number,
    source,
    title: typeof payload.title === 'string' ? payload.title : null,
    content: payload.content,
    metadata: { updated_at: payload.updated_at || null, share_id: slate.share_id || null },
  });
  return {
    content: payload.content,
    title: typeof payload.title === 'string' ? payload.title : null,
    source,
    recoveryType: 'public_cache',
    updatedAt: payload.updated_at || null,
    archived: archived.archived,
  };
}

async function archiveLocalDraft(context) {
  try {
    const raw = localStorage.getItem('justtype-draft');
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (!draft || typeof draft.content !== 'string') return;
    await archivePlaintext(context, {
      source: 'local-storage-draft',
      title: typeof draft.title === 'string' ? draft.title : null,
      content: draft.content,
      metadata: { draft_timestamp: draft.timestamp || null },
    });
  } catch (error) {
    console.warn('slate recovery: local draft archive failed', error);
  }
}

async function incidentCandidates(context, sources) {
  const delegatedBySlate = new Map();
  for (const source of sources) {
    if (!source || typeof source.encrypted_content !== 'string') continue;
    const slateNumber = Number(source.likely_slate_number);
    try {
      if (source.kind === 'historical_revision') {
        const bytes = base64Bytes(source.encrypted_content);
        const sha256 = await sha256Bytes(bytes);
        if (sha256 !== source.sha256 || bytes.length !== Number(source.bytes)) {
          console.error(`slate recovery: archived source ${source.id} failed integrity verification`);
          continue;
        }
      }
      await archiveEncrypted(context, {
        id: `incident:${source.id}`,
        slateNumber,
        source: `incident-${source.kind}`,
        encryptedContent: source.encrypted_content,
        metadata: {
          source_id: source.id,
          uploaded_at: source.uploaded_at || null,
          updated_at: source.updated_at || null,
          expected_sha256: source.sha256 || null,
          expected_bytes: source.bytes || null,
          encrypted_title: source.encrypted_title || null,
          owner_wrapped_key: source.owner_wrapped_key || null,
          last_writer: source.last_writer || null,
        },
      });
      if (!context.masterKey) continue;
      let decrypted;
      if (source.kind === 'delegated_copy') {
        decrypted = await decryptOwnerGrant({
          enc_content: source.encrypted_content,
          enc_title: source.encrypted_title,
          owner_wrapped_key: source.owner_wrapped_key,
        }, context.masterKey);
      } else if (source.kind === 'historical_revision') {
        decrypted = { content: await decryptContent(source.encrypted_content, context.masterKey), title: null };
      } else {
        continue;
      }
      const archived = await archivePlaintext(context, {
        slateNumber,
        source: `incident-${source.kind}:${source.id}`,
        title: decrypted.title,
        content: decrypted.content,
        metadata: {
          source_id: source.id,
          uploaded_at: source.uploaded_at || null,
          last_writer: source.last_writer || null,
          historical_only: source.kind === 'historical_revision',
        },
      });
      // Preserved B2 orphans are historical revisions. Keep them in the local
      // incident vault, but never let them overwrite a canonical slate.
      if (source.kind === 'delegated_copy') {
        const values = delegatedBySlate.get(slateNumber) || [];
        values.push({
          content: decrypted.content,
          title: decrypted.title,
          source: `incident-delegated-copy:${source.id}`,
          recoveryType: 'delegated_copy',
          updatedAt: null,
          archived: archived.archived,
        });
        delegatedBySlate.set(slateNumber, values);
      }
    } catch (error) {
      console.warn(`slate recovery: source ${source.id || 'unknown'} could not be decrypted`, error);
    }
  }
  return delegatedBySlate;
}

async function localVaultCandidates(context) {
  const candidatesBySlate = new Map();
  const records = await getRecoveryRecords(context.userId);
  for (const record of records) {
    const slateNumber = Number(record.slate_number);
    if (!Number.isInteger(slateNumber)) continue;
    try {
      let content = typeof record.content === 'string' ? record.content : null;
      let title = typeof record.title === 'string' ? record.title : null;
      const historicalOnly = Boolean(record.metadata?.historical_only)
        || String(record.source).includes('historical_revision');
      if (!content && typeof record.encrypted_content === 'string' && context.masterKey) {
        if (record.metadata?.owner_wrapped_key) {
          const decrypted = await decryptOwnerGrant({
            enc_content: record.encrypted_content,
            enc_title: record.metadata.encrypted_title || null,
            owner_wrapped_key: record.metadata.owner_wrapped_key,
          }, context.masterKey);
          content = decrypted.content;
          title = decrypted.title;
        } else {
          content = await decryptContent(record.encrypted_content, context.masterKey);
          if (record.metadata?.encrypted_title) {
            title = await decryptTitle(record.metadata.encrypted_title, context.masterKey);
          }
        }
        await archivePlaintext(context, {
          slateNumber,
          source: `local-recovery-vault:${record.source}`,
          title,
          content,
          metadata: { ...record.metadata, historical_only: historicalOnly },
        });
      }
      if (!content || historicalOnly) continue;
      const values = candidatesBySlate.get(slateNumber) || [];
      values.push({
        content,
        title,
        source: `local-recovery-vault:${record.source}`,
        recoveryType: 'recovery_vault',
        updatedAt: record.metadata?.updated_at || null,
        archived: true,
      });
      candidatesBySlate.set(slateNumber, values);
    } catch {
      // Old-key and corrupt records stay archived but cannot be auto-restored.
    }
  }
  return candidatesBySlate;
}

async function loadTitle(slate, candidate, masterKey) {
  if (candidate.title && candidate.title.trim()) return candidate.title.trim();
  if (slate.title && slate.title.trim()) return slate.title.trim();
  if (masterKey && slate.encrypted_title) {
    try {
      const title = await decryptTitle(slate.encrypted_title, masterKey);
      if (title.trim()) return title.trim();
    } catch {
      // Fall through to a content-derived title.
    }
  }
  return candidate.content.split('\n')[0].trim() || 'untitled slate';
}

async function restoreCandidate(context, slate, candidate) {
  if (!candidate.archived) throw new Error('candidate was not archived before restore');
  const title = await loadTitle(slate, candidate, context.masterKey);
  const stats = contentStats(candidate.content);
  let body;
  if (context.e2eMigrated && !slate.is_system_slate) {
    if (!context.masterKey) throw new Error('slates are locked');
    body = {
      encryptedTitle: await encryptTitle(title, context.masterKey),
      encryptedContent: await encryptContent(candidate.content, context.masterKey),
      wordCount: stats.wordCount,
      charCount: stats.charCount,
      sizeBytes: stats.sizeBytes,
      incidentRecovery: true,
      recoverySource: candidate.recoveryType,
    };
  } else {
    body = {
      title,
      content: candidate.content,
      wordCount: stats.wordCount,
      charCount: stats.charCount,
      sizeBytes: stats.sizeBytes,
      incidentRecovery: true,
      recoverySource: candidate.recoveryType,
    };
  }
  const slateUrl = `${API_URL}/slates/${encodeURIComponent(slate.slate_number)}`;
  const response = await fetch(slateUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`restore PUT failed (${response.status})`);
  const putResult = await responseJson(response);
  const verifyResponse = await fetch(slateUrl, { credentials: 'include', cache: 'no-store' });
  const verified = await responseJson(verifyResponse);
  let verifiedContent = null;
  if (verified && typeof verified.content === 'string') verifiedContent = verified.content;
  if (verified && typeof verified.encryptedContent === 'string' && context.masterKey) {
    verifiedContent = await decryptContent(verified.encryptedContent, context.masterKey);
  }
  if (verifiedContent !== candidate.content) throw new Error('restored content verification failed');
  if (slate.is_published && !slate.is_system_slate) {
    const publishResponse = await fetch(`${slateUrl}/publish`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ isPublished: true, publicContent: candidate.content, publicTitle: title }),
    });
    if (!publishResponse.ok) throw new Error(`republish failed (${publishResponse.status})`);
  }
  await reportRecovery(context.userId, putResult?.recovery_receipt || null);
}

async function currentSlateStatus(context, slate) {
  const url = `${API_URL}/slates/${encodeURIComponent(slate.slate_number)}`;
  try {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (response.ok) {
      const payload = await responseJson(response);
      if (payload) await candidateFromPrivatePayload(context, slate, payload, 'healthy-network-copy', false);
      return { state: 'healthy' };
    }
    let body = null;
    try { body = await response.json(); } catch { /* non-JSON error */ }
    return body?.code === 'B2_NOT_FOUND'
      ? { state: 'missing' }
      : { state: 'retryable', status: response.status, code: body?.code || null };
  } catch (error) {
    return { state: 'retryable', error };
  }
}

async function runRecovery(userId, masterKey) {
  await flushPendingReports(userId);
  const previous = readRunState(userId);
  if (previous?.complete) return previous;
  if (previous?.attempted_at && !previous.locked
      && Date.now() - new Date(previous.attempted_at).getTime() < RETRY_AFTER_MS) return previous;

  const context = {
    userId: Number(userId),
    masterKey: masterKey || null,
    e2eMigrated: false,
    bundleRecords: [],
  };
  // Read origin-local storage before any network request can alter cache state.
  const cacheStorage = await scanCacheStorage();
  await archiveLocalDraft(context);

  const authResponse = await fetch(`${API_URL}/auth/me`, { credentials: 'include', cache: 'no-store' });
  if (!authResponse.ok) return null;
  const user = await authResponse.json();
  if (Number(user.id) !== Number(userId)) return null;
  context.e2eMigrated = Boolean(user.e2eMigrated);
  const vaultBySlate = await localVaultCandidates(context);

  let sources = [];
  try {
    const sourceResponse = await fetch(`${API_URL}/account/incident-recovery-sources`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (sourceResponse.ok) {
      const payload = await sourceResponse.json();
      if (Array.isArray(payload.sources)) sources = payload.sources;
    }
  } catch (error) {
    console.warn('slate recovery: incident source request failed', error);
  }
  const delegatedBySlate = await incidentCandidates(context, sources);

  const listResponse = await fetch(`${API_URL}/slates`, { credentials: 'include', cache: 'no-store' });
  if (!listResponse.ok) return null;
  const slates = await listResponse.json();
  if (!Array.isArray(slates)) return null;

  let restored = 0;
  let unresolved = 0;
  let retryable = 0;
  for (const slate of slates) {
    if (slate.adoption_pending) continue;
    const slateNumber = Number(slate.slate_number);
    const candidates = [];
    for (const cached of cacheStorage.privateBySlate.get(slateNumber) || []) {
      const candidate = await candidateFromPrivatePayload(context, slate, cached.payload, cached.source);
      if (candidate) candidates.push(candidate);
    }
    const httpPrivate = await onlyCachedJson(`${API_URL}/slates/${encodeURIComponent(slateNumber)}`);
    if (httpPrivate) {
      const candidate = await candidateFromPrivatePayload(context, slate, httpPrivate, 'http-cache-private');
      if (candidate) candidates.push(candidate);
    }
    if (slate.share_id) {
      for (const cached of cacheStorage.publicByShare.get(String(slate.share_id)) || []) {
        const candidate = await candidateFromPublicPayload(context, slate, cached.payload, cached.source);
        if (candidate) candidates.push(candidate);
      }
      const httpPublic = await onlyCachedJson(`${API_URL}/public/slates/${encodeURIComponent(slate.share_id)}`);
      if (httpPublic) {
        const candidate = await candidateFromPublicPayload(context, slate, httpPublic, 'http-cache-public');
        if (candidate) candidates.push(candidate);
      }
    }
    candidates.push(...(vaultBySlate.get(slateNumber) || []));
    candidates.push(...(delegatedBySlate.get(slateNumber) || []));
    const current = await currentSlateStatus(context, slate);
    if (current.state === 'healthy') continue;
    if (current.state !== 'missing') {
      retryable++;
      continue;
    }
    const exact = candidates.find((candidate) => candidate && recoveryContentMatches(slate, candidate.content, {
      e2eMigrated: context.e2eMigrated,
      updatedAt: candidate.updatedAt,
    }));
    if (!exact || (context.e2eMigrated && !context.masterKey)) {
      unresolved++;
      continue;
    }
    try {
      await restoreCandidate(context, slate, exact);
      restored++;
    } catch (error) {
      retryable++;
      console.error(`slate recovery: restore #${slateNumber} failed`, error);
    }
  }

  const state = {
    attempted_at: new Date().toISOString(),
    complete: unresolved === 0 && retryable === 0 && !(context.e2eMigrated && !context.masterKey),
    locked: context.e2eMigrated && !context.masterKey,
    restored,
    unresolved,
    retryable,
    archived_records: context.bundleRecords.length,
  };
  writeRunState(userId, state);
  console.info(`slate recovery: restored ${restored}, unresolved ${unresolved}, retryable ${retryable}, archived ${context.bundleRecords.length}`);
  return state;
}

export function recoverLostSlates(userId, masterKey = null) {
  if (!userId) return Promise.resolve(null);
  const key = String(userId);
  const active = running.get(key);
  if (active) {
    if (masterKey && !active.hasMasterKey) {
      return active.promise.finally(() => recoverLostSlates(userId, masterKey));
    }
    return active.promise;
  }
  const entry = { hasMasterKey: Boolean(masterKey), promise: null };
  const promise = runRecovery(userId, masterKey).finally(() => {
    if (running.get(key) === entry) running.delete(key);
  });
  entry.promise = promise;
  running.set(key, entry);
  return promise;
}
