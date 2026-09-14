import React, { useState, useEffect, useRef, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../config';
import { VERSION } from '../version';
import { strings } from '../strings';
import { builtInThemes, hiddenThemes, getThemeIds, getTheme, isCustomTheme, addCustomTheme, removeCustomTheme, getExampleThemeJson, validateTheme, applyThemeVariables, syncThemeToServer, syncCustomThemesToServer, MAX_CUSTOM_THEMES, getCustomThemeCount, deviceDefaultTheme } from '../themes';
import { encryptContent, decryptContent, encryptTitle, decryptTitle, encryptTags, decryptTags, reencryptForApp, decryptOwnerGrant, unwrapKey, wrapKey } from '../crypto';
import { useScroll, centerTextareaCaret } from '../typewriter';
import { isScratchNumber, readScratch, writeScratch } from '../scratch';
import { markdownOf, FRONT_MATTER, useFrontMatter, setFrontMatter, nextFrontMatter } from '../exporter';
import { getSlateKey } from '../keyStore';
import { loadHistory, heldHistory, prepareCheckpoint, commitHistory, labelVersion, forgetHistory, enableHistory, disableHistory } from '../history';
import { publishTheme, withdrawTheme, myThemeStates, fetchCatalog, themeSlate, forgetThemeSlate } from '../themeCatalog';
import { fetchSharedSlate } from '../collab';
import { usePresence } from '../presence';
import { withViewTransition } from '../viewTransition';
import { TextMorph } from './TextMorph';
import { PUNTO_SIZES, nextPunto, usePunto, setPunto } from '../punto';
import { cue } from '../cues';
import { HoverNote } from './HoverNote';
import { VerifyBadge } from './VerifyBadge';
import { SupportButtons } from './SupportButtons';
import { useEscape } from '../useEscape';
import { useConnectivity, reportNetworkFailure, isOnline } from '../connectivity';
import { cacheSlate, getCachedSlate, deleteCachedSlate, getPendingFor, queuePending, newLocalSlateNumber, isLocalSlateNumber, pruneCache } from '../offlineStore';
import { onSync, watchConnectivity, queueOfflineSave, mergeWithServer } from '../offlineSync';
import { nearbyPeerCount, onNearbyChange } from '../nearbyState';
import { SettingsRow, controlLabel } from './SettingsRow';
import { LockPanel } from './LockPanel';
import { LockRecoverModal } from './LockRecoverModal';
import { SharePanel } from './SharePanel';
import { makeShareKey, fragmentOf, encryptShare, wrapForPassphrase, expiryAt, expiryChoice } from '../share';
import { openDocKey, onLockChange, relock, relockOthers, touchLock, fetchLockRecovery, currentRecoveryKey, ensureLockRecovery, loginKind, loginKindsOf, waysOf, recoveryWaysFor, verifyLogin, verifyRecoveryWay, unlockSlate, recoverSlate, saveLockChange } from '../slateLock';

// Colour of the status word in the strip and the mobile sheet: failures
// red, private-draft states orange, everything else green
const statusTone = (status) => {
  const { privateDraft, savedAsPrivate } = strings.writer.status;
  if (status === strings.errors.saveFailed || status === strings.writer.connectivity.notSaved) return 'text-red-400';
  if (status === privateDraft || status === savedAsPrivate || /\bto resolve$/.test(status)) return 'text-orange-400';
  return 'text-green-500';
};
// Offline, a failed save is expected and reads as a state, not a failure
const saveFailedStatus = () => isOnline() ? strings.errors.saveFailed : strings.writer.connectivity.notSaved;

// The rich editor and the collab editor are separate chunks: they are
// content-hashed, so a deploy that only touches app code leaves the ~500 kB of
// CodeMirror sitting in the browser cache untouched. Each is fetched exactly
// once per page load, whoever asks first.
let editorChunk = null;
const loadEditorChunk = () => (editorChunk ||= import('./LivePreviewEditor'));
let collabChunk = null;
const loadCollabChunk = () => (collabChunk ||= import('./CollabEditor'));

// Whether this visitor is likely to open a rich editor at all. Signed-in users
// may have rich slates waiting; anyone whose local draft is rich certainly
// does. For a first-time anonymous visitor (plain textarea, no slates) there is
// nothing to preload, so they are not charged for it.
const richEditorLikely = () => {
  try {
    return localStorage.getItem('justtype-draft-mode') === 'wysiwyg'
      || !!localStorage.getItem('justtype-username');
  } catch (e) {
    return false;
  }
};

// Timing is the whole point. A rich slate renders its editor the moment the
// slate metadata lands, which is a network round trip after boot; starting the
// chunk here (module parse, i.e. before that request even goes out) means it has
// normally resolved by then, React.lazy renders synchronously, and the
// "loading rich editor..." fallback never paints. The old code warmed these from
// requestIdleCallback, which routinely lost that race.
if (typeof window !== 'undefined') {
  if (richEditorLikely()) {
    loadEditorChunk();
    loadCollabChunk();
  } else if ('requestIdleCallback' in window) {
    requestIdleCallback(() => loadEditorChunk(), { timeout: 5000 });
  }
}

const TiptapEditor = React.lazy(() => loadEditorChunk());
// Read-only rendered view, used as the print copy for pdf export of rich slates
const MarkdownViewLazy = React.lazy(() => loadEditorChunk().then(m => ({ default: m.MarkdownView })));
// Collaborative editor (yjs + remote carets) — its own on-demand chunk
const CollabEditorLazy = React.lazy(() => loadCollabChunk());
// Collab side panel (people + version history; carries yjs) — on demand, and
// rare enough that it is never prefetched.
const CollabPanelLazy = React.lazy(() => import('./CollabPanel'));

/** A link inside the about card: white, and always a new tab so the modal (and
 *  whatever is unsaved behind it) is never navigated away from. */
function AboutLink({ href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[var(--theme-accent)] hover:underline underline-offset-2 transition-colors"
    >
      {children}
    </a>
  );
}

/**
 * A horizontally scrolling row with its own scroll indicator.
 *
 * Native scrollbars are invisible on iOS and auto-hiding elsewhere, so a row
 * that continues past the edge looks like a row that simply got cut off. This
 * draws a thumb whose width is the visible fraction and whose position tracks
 * scrollLeft, which is the same technique the desktop settings strip uses.
 */
function ScrollRow({ children, className = '' }) {
  const ref = useRef(null);
  const [bar, setBar] = useState(null); // { width, left } as percentages, or null when it all fits

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollWidth, clientWidth, scrollLeft } = el;
    if (scrollWidth <= clientWidth + 1) {
      setBar((prev) => (prev === null ? prev : null));
      return;
    }
    const width = Math.max(14, (clientWidth / scrollWidth) * 100);
    const left = (scrollLeft / (scrollWidth - clientWidth)) * (100 - width);
    setBar((prev) =>
      prev && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.width - width) < 0.5 ? prev : { width, left }
    );
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  return (
    <div className={className}>
      <div ref={ref} onScroll={measure} className="flex gap-2 overflow-x-auto settings-strip no-native-scrollbar">
        {children}
      </div>
      <div className="h-[3px] mt-2 rounded-full bg-[var(--theme-border)]/40 overflow-hidden" style={{ opacity: bar ? 1 : 0 }}>
        <div
          className="h-full rounded-full bg-[var(--theme-text-dim)] transition-[margin] duration-75"
          style={{ width: `${bar ? bar.width : 0}%`, marginLeft: `${bar ? bar.left : 0}%` }}
        />
      </div>
    </div>
  );
}

/** A labelled row in the mobile sheet: full-width target, optional right-hand value. */
function SheetRow({ label, value, accent, onClick, highlight }) {
  return (
    <button
      onClick={onClick}
      className={`w-full h-12 px-4 bg-[var(--theme-bg)] active:bg-[var(--theme-bg-tertiary)] transition-colors flex items-center justify-between text-left text-sm ${highlight ? 'feature-pulse' : ''}`}
    >
      <span className="text-[var(--theme-text)]">{label}</span>
      {value && <span className={accent || 'text-[var(--theme-text-dim)]'}>{value}</span>}
    </button>
  );
}

/**
 * Placeholder for a rich editor chunk that has not resolved yet. It renders the
 * document as plain text with the editor's own padding, width and type scale, so
 * when the real editor mounts the words do not move. Beats a spinner: on a fast
 * connection this is never seen at all, and on a slow one the user can already
 * read their slate.
 */
function EditorSkeleton({ text, punto }) {
  return (
    <div className={`w-full max-w-3xl p-8 leading-relaxed whitespace-pre-wrap punto-${punto}`}>
      {text || ''}
    </div>
  );
}

// Live re-sync (push): re-wrap the just-saved plaintext to every app that should
// hold a copy of this slate — apps with an explicit grant AND apps the user gave
// "share all" access (so brand-new slates auto-share). The content key is wrapped
// to both the app's public key and the user's master key, marking last_writer =
// 'owner'. Best-effort and non-blocking; the server only stores opaque blobs.
async function resyncSharedGrants(slateNumber, content, title, masterKey) {
  try {
    const res = await fetch(`${API_URL}/account/slate-grants/by-slate/${encodeURIComponent(slateNumber)}`, { credentials: 'include' });
    if (!res.ok) return;
    const apps = await res.json();
    if (!Array.isArray(apps) || apps.length === 0) return;
    for (const app of apps) {
      try {
        // Wrap the fresh content key to every registered install of this app.
        if (!app.device_keys || app.device_keys.length === 0) continue;
        const grant = await reencryptForApp(content, title, app.device_keys, masterKey);
        await fetch(`${API_URL}/account/slate-grants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ client_id: app.client_id, slate_number: slateNumber, ...grant })
        });
      } catch (e) { console.warn('grant re-sync failed for', app.client_id, e); }
    }
  } catch { /* best-effort */ }
}

// Persist adopted content as the canonical (master-key encrypted) slate.
async function persistCanonical(slateNumber, content, title, masterKey) {
  const titleToSave = (title && title.trim()) || (content.split('\n')[0].trim() || 'untitled slate');
  const encryptedContent = await encryptContent(content, masterKey);
  const encryptedTitle = await encryptTitle(titleToSave, masterKey);
  const wordCount = content.trim() === '' ? 0 : content.trim().split(/\s+/).length;
  const charCount = content.length;
  const sizeBytes = new TextEncoder().encode(content).length;
  await fetch(`${API_URL}/slates/${encodeURIComponent(slateNumber)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ encryptedTitle, encryptedContent, wordCount, charCount, sizeBytes })
  });
}

// Pull (two-way sync): if a third-party app has edited this slate since the user
// last touched it (last_writer = 'app'), decrypt that edit with the master key,
// adopt it as the canonical slate, and re-sync (which marks everything 'owner'
// again, clearing the pull flag). Returns the adopted { content, title } or null.
async function pullAppEdits(slateNumber, masterKey) {
  try {
    const res = await fetch(`${API_URL}/account/slate-grants/by-slate/${encodeURIComponent(slateNumber)}`, { credentials: 'include' });
    if (!res.ok) return null;
    const apps = await res.json();
    if (!Array.isArray(apps)) return null;
    const pending = apps.find((a) => a.grant && a.grant.last_writer === 'app' && a.grant.owner_wrapped_key);
    if (!pending) return null;
    const { content, title } = await decryptOwnerGrant(pending.grant, masterKey);
    await persistCanonical(slateNumber, content, title, masterKey);
    await resyncSharedGrants(slateNumber, content, title, masterKey);
    return { content, title };
  } catch (e) {
    console.warn('pull app edits failed for', slateNumber, e);
    return null;
  }
}

// Tags of a loaded slate sit under its doc key when it is collaborative
const collabDocKeyRefForTags = (data, slateKey) => (data.is_collab && data.collab_wrapped_key ? unwrapKey(data.collab_wrapped_key, slateKey) : slateKey);

export const Writer = forwardRef(({ token, userId, currentSlate, onSlateChange, onLogin, onZenModeChange, parentZenMode, onOpenAuthModal, sharedSlateId = null, onOpenAsNewSlate }, ref) => {
  const [content, setContent] = useState('');
  // Mirrors `content` for effects that must see the value as of *now* rather
  // than as of the render they closed over (see the slate-load effect below).
  const contentRef = useRef('');
  contentRef.current = content;
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('ready');
  const [zenMode, setZenMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // Caret memory, per device: where the caret and the scroll were when the
  // slate was last left, kept with the device copy and put back on open
  const mainRef = useRef(null);
  const caretRestoreRef = useRef(null);   // { anchor, head, scroll } | { end: true }
  const caretSlateRef = useRef(null);     // the slate whose caret is being tracked
  const pendingTagsRef = useRef(null);    // tags for a slate about to be created
  const scrollMode = useScroll();
  const frontMatter = useFrontMatter();
  const slateFactsRef = useRef({}); // created_at, updated_at, tags of the open slate, for exports
  const [loadingFadeOut, setLoadingFadeOut] = useState(false);
  const [contentFadeKey, setContentFadeKey] = useState(0);
  const [showPublishMenu, setShowPublishMenu] = useState(false);
  const [shareUrl, setShareUrl] = useState(null);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [editorMode, setEditorModeState] = useState('plain'); // 'plain' | 'wysiwyg' — a per-document setting
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  // Drag-to-dismiss for the mobile sheet: how far it has been pulled down, and
  // whether a finger is currently on it (which turns the snap transition off so
  // the sheet tracks the finger exactly).
  const [sheetDrag, setSheetDrag] = useState({ y: 0, dragging: false });
  const sheetDragRef = useRef({ startY: 0, y: 0, dragging: false });
  // pointerup is followed by a click; a drag that snapped back must not also
  // register as a tap on the handle (which would close the sheet anyway).
  const sheetTapSuppressed = useRef(false);
  // Swipe-up-to-open on the collapsed pill, so the sheet answers the same
  // gesture that dismisses it.
  const triggerSwipeRef = useRef({ startY: 0, active: false, opened: false });
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishModalUrl, setPublishModalUrl] = useState('');
  // The share panel and what the server holds about the slate's link
  const [sharePanel, setSharePanel] = useState(false);
  const [shareInfo, setShareInfo] = useState(null); // { private, wrappedKey, passSalt, passWrappedKey, expiresAt }
  const [shareLink, setShareLink] = useState(null); // the private link with its key in the fragment
  const [shareBusy, setShareBusy] = useState(false);
  const [sharePending, setSharePending] = useState(false); // passphrase chosen, not typed yet
  const shareKeyRef = useRef(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [wasPublishedBeforeEdit, setWasPublishedBeforeEdit] = useState(false);
  const [nudgeShown, setNudgeShown] = useState(false);
  const [showDonateModal, setShowDonateModal] = useState(false);
  const [donateAmount, setDonateAmount] = useState('3');
  const [donateEmail, setDonateEmail] = useState('');
  const [showAlreadySubscribedModal, setShowAlreadySubscribedModal] = useState(false);
  const [supporterTier, setSupporterTier] = useState(null);
  const [showEditingOptions, setShowEditingOptions] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  // After the v4 card is dismissed, the two things it advertised get pointed at
  // rather than left for the user to find.
  const [highlightNew, setHighlightNew] = useState(false);
  // Collaborative slate: the doc key the content is encrypted under (null for
  // solo slates). Set on load from the owner's wrapped copy, or by the share
  // modal when sharing is turned on/off.
  const [collabDocKey, setCollabDocKey] = useState(null);
  // Locked slate: its doc key while the lock is open; `isLocked` is the
  // slate's flag; `lockGate` holds the slate the lock is keeping shut;
  // `lockPrompt` asks for the secret before a slate gets locked
  const [lockDocKey, setLockDocKey] = useState(null);
  const [isLocked, setIsLocked] = useState(false);
  const [lockGate, setLockGate] = useState(null);
  const lockGateRef = useRef(null);
  const [lockPrompt, setLockPrompt] = useState(null);
  // The slate number `isLocked` speaks for, and the last slate loaded:
  // moving to another slate shuts the lock
  const lockedSlateRef = useRef(null);
  const lockedSlateMetaRef = useRef(null);
  const lastLoadedRef = useRef(null);
  useEffect(() => {
    if (currentSlate) return;
    lastLoadedRef.current = null;
    lockedSlateRef.current = null;
    lockGateRef.current = null;
    setLockGate(null);
    setLockPrompt(null);
    setLockDocKey(null);
    setIsLocked(false);
    relock();
  }, [currentSlate?.slate_number]);
  // Bumped whenever the doc key changes (enable, rotation, rekey) to remount
  // the collab editor, and to re-run the shared load after a rotation.
  const [collabKeyGen, setCollabKeyGen] = useState(0);
  const [collabReloadKey, setCollabReloadKey] = useState(0);
  // null | 'people' | 'history' — the collab side panel and which tab it shows
  const [collabPanel, setCollabPanel] = useState(null);
  // Live handle into the collab editor ({ replaceText }) for history restores
  const collabApiRef = useRef(null);
  // Rooms are keyed by the slate's DB id (not the per-user slate_number)
  const [collabSlateDbId, setCollabSlateDbId] = useState(null);
  // Shared mode: this Writer shows a slate someone else owns — same surface,
  // no owner powers (no PUT saves, publish, or member management)
  const isShared = !!sharedSlateId;
  // The scratch slate: this device only, no number on the server
  const isScratch = !!currentSlate?.scratch || isScratchNumber(currentSlate?.slate_number);
  const [sharedBy, setSharedBy] = useState(null);
  const [sharedRemoved, setSharedRemoved] = useState(false);
  // Two-step "unpublish completely": arms sure?, reverts after 3s untouched
  const [confirmForget, setConfirmForget] = useState(false);
  // One id per new slate, sent as the create's idempotency key and reused
  // as the local number if the save falls back to the device, so a lost
  // response or a queued retry can never create the slate twice.
  const newSlateRefRef = useRef(null);
  const forgetTimerRef = useRef(null);
  // The settings strip scrolls when the window is narrow, so its popovers
  // (theme picker, share menu) anchor to the viewport instead of the strip —
  // an overflow container would clip anything opening upward out of it.
  const [popoverAnchor, setPopoverAnchor] = useState(null);
  const anchorPopover = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPopoverAnchor({
      left: Math.min(r.left, window.innerWidth - 190),
      bottom: window.innerHeight - r.top + 8
    });
  };
  // Decrypted blob content at load time — seeds the Y.Doc on a collab doc's first open
  const loadedContentRef = useRef('');
  const collabPeers = usePresence({
    slateId: collabSlateDbId,
    docKey: collabDocKey,
    username: localStorage.getItem('justtype-username'),
    enabled: !!(collabSlateDbId && collabDocKey)
  });
  const [isMenuClosing, setIsMenuClosing] = useState(false);
  const [showMenuButton, setShowMenuButton] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [printJob, setPrintJob] = useState(0); // >0 while a pdf export's print copy is mounted
  const { online, updateAvailable } = useConnectivity();
  // Devices connected directly to this slate (nearby collab)
  const [nearbyCount, setNearbyCount] = useState(0);
  useEffect(() => {
    const refresh = () => setNearbyCount(collabSlateDbId ? nearbyPeerCount(collabSlateDbId) : 0);
    refresh();
    return onNearbyChange(refresh);
  }, [collabSlateDbId]);
  // The version of the open slate as loaded (server timestamp + encrypted
  // blob): the base its edits started from, for conflict detection and merge
  const loadedSlateRef = useRef(null);
  // The number of a slate this editor just created (or that got its server
  // number after an offline save): its text is already on screen, so the
  // load effect adopts the number instead of refetching behind the overlay
  const adoptedSlateRef = useRef(null);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [themeImportError, setThemeImportError] = useState(null);
  // Catalog: which custom theme has its menu open, where each one stands in
  // review (by slate number), and the browse list once fetched
  const [themeMenuId, setThemeMenuId] = useState(null);
  const [themeStates, setThemeStates] = useState({});
  const [publishingTheme, setPublishingTheme] = useState(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalog, setCatalog] = useState(null);
  const themeFileInputRef = useRef(null);
  const [focusMode, setFocusMode] = useState(() => localStorage.getItem('justtype-focus-mode') || 'off'); // 'off' | 'on' | 'auto'
  const [showCounter, setShowCounter] = useState(() => localStorage.getItem('justtype-show-counter') !== 'false');
  const autoZenTimeoutRef = useRef(null);
  const autoZenActiveRef = useRef(false);
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('justtype-theme') || deviceDefaultTheme();
  });
  const [previewTheme, setPreviewTheme] = useState(null); // For hover preview
  const punto = usePunto();
  const [threeDotsTransform, setThreeDotsTransform] = useState(0);
  const textareaRef = useRef(null);
  const richEditorRef = useRef(null); // LivePreviewEditor handle ({ focus })
  const saveTimeoutRef = useRef(null);
  const saveMenuTimeoutRef = useRef(null);
  const announceRef = useRef(null);
  // A slate's first save, from 'saving...' until its address has been shown:
  // the status stays visible through focus mode and autosaves stay quiet
  const [announcing, setAnnouncing] = useState(false);
  // The slate on screen right now, for a save that finishes after the user
  // has moved on to another one
  const currentSlateRef = useRef(currentSlate);
  currentSlateRef.current = currentSlate;
  const [footerHover, setFooterHover] = useState(false);
  // True once the folded group has finished unfolding: only then may its
  // popovers (the save menu) overflow the box
  const [chromeSettled, setChromeSettled] = useState(true);
  useEffect(() => {
    const open = !zenMode || footerHover;
    if (!open) { setChromeSettled(false); return; }
    const t = setTimeout(() => setChromeSettled(true), 500);
    return () => clearTimeout(t);
  }, [zenMode, footerHover]);
  const announcingRef = useRef(false);
  // The words the status slot fades out with (it never reads 'ready')
  const [shownStatus, setShownStatus] = useState('');
  useEffect(() => { if (status !== 'ready') setShownStatus(status); }, [status]);
  const lastSavedContentRef = useRef('');
  const keystrokeDetectedRef = useRef(false);
  const nudgeTimeoutRef = useRef(null);
  const settingsMenuRef = useRef(null);
  const threeDotsRef = useRef(null);
  const draftRestoredRef = useRef(false);
  const localDraftTimeoutRef = useRef(null);
  // Settings strip overflow: fades apply only where more content hides, and a
  // slim thumb under the strip hints that it scrolls. The thumb is driven
  // through refs so scrolling never re-renders the component.
  const stripRef = useRef(null);
  const stripTrackRef = useRef(null);
  const stripThumbRef = useRef(null);
  const stripScrollEndTimerRef = useRef(null);
  const [stripFade, setStripFade] = useState({ l: false, r: false });

  const updateStripScroll = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const overflowing = max > 1;
    const l = overflowing && el.scrollLeft > 1;
    const r = overflowing && el.scrollLeft < max - 1;
    setStripFade((prev) => (prev.l === l && prev.r === r ? prev : { l, r }));
    const track = stripTrackRef.current;
    const thumb = stripThumbRef.current;
    if (track && thumb) {
      track.classList.toggle('visible', overflowing);
      if (overflowing) {
        const trackWidth = track.clientWidth;
        const thumbWidth = Math.max(24, (el.clientWidth / el.scrollWidth) * trackWidth);
        const left = (el.scrollLeft / max) * (trackWidth - thumbWidth);
        thumb.style.width = `${thumbWidth}px`;
        thumb.style.transform = `translateX(${left}px)`;
      }
    }
  }, []);

  useEffect(() => {
    if (!showMenuButton) return;
    const el = stripRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateStripScroll);
    ro.observe(el);
    window.addEventListener('resize', updateStripScroll);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateStripScroll);
      clearTimeout(stripScrollEndTimerRef.current);
    };
  }, [showMenuButton, updateStripScroll]);

  // The strip's contents change with state (labels grow, buttons appear) —
  // a cheap re-measure after every render keeps the fades honest.
  useEffect(() => { if (showMenuButton) updateStripScroll(); });

  // Restore local draft on initial mount (only if no slate is being loaded)
  useEffect(() => {
    // Only restore if we're on a new slate (no currentSlate) and no content yet
    if (!currentSlate && !sharedSlateId && !content) {
      // Restore the draft's editor mode preference too
      if (localStorage.getItem('justtype-draft-mode') === 'wysiwyg') {
        setEditorModeState('wysiwyg');
      }
      try {
        const savedDraft = localStorage.getItem('justtype-draft');
        if (savedDraft) {
          const draft = JSON.parse(savedDraft);
          if (draft.content && draft.content.trim()) {
            setContent(draft.content);
            contentRef.current = draft.content;
            if (draft.title) setTitle(draft.title);
            draftRestoredRef.current = true;
            setHasUnsavedChanges(true);
            setStatus(strings.writer.status.draftRestored);
            setTimeout(() => setStatus('ready'), 3000);
          }
        }
      } catch (e) {
        // Ignore invalid draft data
        localStorage.removeItem('justtype-draft');
      }
    }
  }, []); // Only run on mount

  // Save local draft when content changes (for new slates only)
  useEffect(() => {
    // Skip if we just restored a draft (prevent immediate re-save)
    if (draftRestoredRef.current) {
      draftRestoredRef.current = false;
      return;
    }

    // Only save draft for new slates (not when editing existing ones,
    // and never for a slate someone shared with us)
    if (currentSlate || isShared) {
      return;
    }

    // Clear existing timeout
    if (localDraftTimeoutRef.current) {
      clearTimeout(localDraftTimeoutRef.current);
    }

    // Debounce localStorage writes
    localDraftTimeoutRef.current = setTimeout(() => {
      if (content.trim()) {
        localStorage.setItem('justtype-draft', JSON.stringify({
          content,
          title,
          timestamp: Date.now()
        }));
      } else {
        // Clear draft if content is empty
        localStorage.removeItem('justtype-draft');
      }
    }, 500);

    return () => {
      if (localDraftTimeoutRef.current) {
        clearTimeout(localDraftTimeoutRef.current);
      }
    };
  }, [content, title, currentSlate]);

  // Load a slate someone shared with us: same Writer surface, content comes
  // through the collab read path and every edit syncs over the relay.
  useEffect(() => {
    if (!sharedSlateId || !token) return;
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const data = await fetchSharedSlate(sharedSlateId, userId);
        if (cancelled) return;
        loadedContentRef.current = data.content || '';
        setContent(data.content || '');
        setTitle(data.title || 'untitled slate');
        setEditorModeState(data.editorMode === 'wysiwyg' ? 'wysiwyg' : 'plain');
        setSharedBy(data.owner);
        setSharedRemoved(false);
        setCollabDocKey(data.docKey);
        setCollabKeyGen((g) => g + 1);
        setCollabSlateDbId(sharedSlateId);
        lastSavedContentRef.current = JSON.stringify({ content: data.content || '' });
        setHasUnsavedChanges(false);
        setLoadingFadeOut(true);
        setContentFadeKey(prev => prev + 1);
        setTimeout(() => { setIsLoading(false); setLoadingFadeOut(false); }, 300);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load shared slate:', err);
        setStatus(String(err.message || 'failed to load').toLowerCase());
        setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sharedSlateId, token, userId, collabReloadKey]);

  // The doc key rotated under us (owner removed someone or revoked a link).
  // Re-resolve our wrapped copy and rebuild the editor from the fresh blob.
  const handleCollabRekeyed = useCallback(() => {
    if (isShared) {
      setCollabReloadKey((k) => k + 1);
      return;
    }
    if (!currentSlate) return;
    (async () => {
      try {
        const masterKey = userId ? await getSlateKey(userId) : null;
        const res = await fetch(`${API_URL}/slates/${currentSlate.slate_number}`, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.collab_wrapped_key || !masterKey) return;
        const newKey = await unwrapKey(data.collab_wrapped_key, masterKey);
        const plain = data.encryptedContent ? await decryptContent(data.encryptedContent, newKey) : '';
        loadedContentRef.current = plain;
        setContent(plain);
        lastSavedContentRef.current = JSON.stringify({ content: plain });
        setCollabDocKey(newKey);
        setCollabKeyGen((g) => g + 1);
      } catch (e) {
        console.warn('rekey resolve failed', e);
      }
    })();
  }, [isShared, currentSlate, userId]);

  // Load current slate
  useEffect(() => {
    if (isShared) return;
    if (currentSlate && token) {
      if (adoptedSlateRef.current != null && adoptedSlateRef.current === currentSlate.slate_number) {
        adoptedSlateRef.current = null;
        return;
      }
      setIsLoading(true);
      loadSlate(currentSlate.slate_number);
    } else if (!currentSlate && !contentRef.current.trim()) {
      // Only clear content if there's no current slate AND no content
      // This prevents clearing user's work when they log in after writing,
      // and (via the ref) a restored local draft from being wiped by this
      // effect running later in the same commit.
      setContent('');
      setTitle('');
      setHasUnsavedChanges(false);
      setWasPublishedBeforeEdit(false);
      lastSavedContentRef.current = '';
      setIsLoading(false);
    }
  }, [currentSlate, token]);

  // Autofocus the editor on a blank slate (so user can "just type"). The rich
  // editor is a lazy chunk that may mount after this runs; its `autofocus`
  // prop covers that first mount.
  useEffect(() => {
    if (currentSlate || isLoading) return;
    const ta = textareaRef.current;
    if (ta) {
      // Caret at the end, same as the rich editor's focus handle
      ta.setSelectionRange(ta.value.length, ta.value.length);
      ta.focus();
    } else if (richEditorRef.current) {
      richEditorRef.current.focus();
    }
  }, [currentSlate, isLoading]);

  // Notify parent about zen mode changes
  useEffect(() => {
    if (onZenModeChange) {
      onZenModeChange(zenMode);
    }
  }, [zenMode, onZenModeChange]);

  // Apply theme to body (uses previewTheme on hover, otherwise actual theme)
  useEffect(() => {
    const activeTheme = previewTheme || theme;

    // Apply CSS variables and body classes for this theme
    applyThemeVariables(activeTheme);

    // Only save to localStorage when not previewing
    if (!previewTheme) {
      localStorage.setItem('justtype-theme', theme);
    }
  }, [theme, previewTheme]);

  // Save focus mode preference to localStorage
  useEffect(() => {
    localStorage.setItem('justtype-focus-mode', focusMode);
  }, [focusMode]);

  // Save counter visibility to localStorage
  useEffect(() => {
    localStorage.setItem('justtype-show-counter', showCounter.toString());
  }, [showCounter]);

  // Handle focus mode changes
  useEffect(() => {
    if (focusMode === 'on') {
      setZenMode(true);
    } else if (focusMode === 'off') {
      setZenMode(false);
      autoZenActiveRef.current = false;
    } else if (focusMode === 'auto') {
      // Reset to off state, auto will kick in when typing
      setZenMode(false);
      autoZenActiveRef.current = false;
    }
  }, [focusMode]);

  // Auto focus: enter zen mode when typing, exit on mouse move or after 3 seconds of inactivity
  useEffect(() => {
    if (focusMode !== 'auto') return;

    const handleTyping = (e) => {
      // Only trigger on actual typing in the editor, not shortcuts. The rich
      // editor is a CM6 contenteditable (.cm-content), not the textarea.
      const inPlain = e.target === textareaRef.current;
      const inRich = e.target instanceof Element && e.target.closest('.cm-content');
      if (!inPlain && !inRich) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Enter zen mode if not already in it
      if (!zenMode && !autoZenActiveRef.current) {
        setZenMode(true);
        autoZenActiveRef.current = true;
      }

      // Reset the inactivity timer
      if (autoZenTimeoutRef.current) {
        clearTimeout(autoZenTimeoutRef.current);
      }

      autoZenTimeoutRef.current = setTimeout(() => {
        if (autoZenActiveRef.current) {
          setZenMode(false);
          autoZenActiveRef.current = false;
        }
      }, 3000);
    };

    const handleMouseMove = () => {
      // Exit zen mode on any mouse movement
      if (autoZenActiveRef.current) {
        if (autoZenTimeoutRef.current) {
          clearTimeout(autoZenTimeoutRef.current);
        }
        setZenMode(false);
        autoZenActiveRef.current = false;
      }
    };

    window.addEventListener('keydown', handleTyping);
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('keydown', handleTyping);
      window.removeEventListener('mousemove', handleMouseMove);
      if (autoZenTimeoutRef.current) {
        clearTimeout(autoZenTimeoutRef.current);
      }
    };
  }, [focusMode, zenMode]);

  // Handle menu close with animation
  const handleCloseMenu = () => {
    if (!showSettingsMenu) return;
    setIsMenuClosing(true);
    // Wait for animation to complete before hiding
    setTimeout(() => {
      setShowSettingsMenu(false);
      setShowMenuButton(false);
      setIsMenuClosing(false);
    }, 500); // Match the animation duration
  };

  const handleToggleMenu = () => {
    if (showSettingsMenu) {
      // The strip plays its exit (the open animation reversed) before it unmounts
      handleCloseMenu();
    } else {
      // Calculate distance to align with zen mode button's left edge
      if (threeDotsRef.current) {
        const rect = threeDotsRef.current.getBoundingClientRect();
        // Subtract a bit to align with "z" in zen mode, not absolute edge
        setThreeDotsTransform(rect.left - 32); // 32px offset to align with zen mode text
      }
      setShowSettingsMenu(true);
      setIsMenuClosing(false);
      // Show menu button after animation completes
      setTimeout(() => {
        setShowMenuButton(true);
      }, 500);
    }
  };

  // Close settings menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target)) {
        if (showSettingsMenu && !isMenuClosing) {
          setIsMenuClosing(true);
          setShowThemePicker(false);
          // Delay hiding menu buttons until after animation completes
          setTimeout(() => {
            setShowMenuButton(false);
            setShowSettingsMenu(false);
            setIsMenuClosing(false);
          }, 500);
        }
      }
      // Close theme picker if clicking outside
      if (showThemePicker && !event.target.closest('[data-theme-picker]')) {
        setShowThemePicker(false);
      }
    };

    if (showSettingsMenu || showThemePicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSettingsMenu, isMenuClosing, showThemePicker]);

  // Warn user before leaving with unsaved changes (only on actual page unload, not internal navigation)
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      // Only trigger for actual page navigation (close tab, refresh, external link)
      // Never trigger for internal React navigation
      if (hasUnsavedChanges && content.trim()) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges, content]);

  // Handle donate query parameter
  useEffect(() => {
    const checkSubscriptionAndDonate = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const donate = urlParams.get('donate');

      if (donate === 'one_time') {
        setShowDonateModal(true);
        window.history.replaceState({}, '', '/');
      } else if (donate === 'quarterly') {
        if (!token) {
          onOpenAuthModal();
        } else {
          // Check if user is already subscribed
          try {
            const response = await fetch(`${API_URL}/account/storage`, {
              credentials: 'include'
            });
            const data = await response.json();
            if (response.ok) {
              if (data.supporterTier === 'quarterly') {
                // Already subscribed - show modal
                setShowAlreadySubscribedModal(true);
              } else {
                // Not subscribed - proceed to checkout
                handleStripeCheckout('quarterly');
              }
            } else {
              // Failed to check - proceed anyway
              handleStripeCheckout('quarterly');
            }
          } catch (err) {
            console.error('Failed to check subscription status:', err);
            // Failed to check - proceed anyway
            handleStripeCheckout('quarterly');
          }
        }
        window.history.replaceState({}, '', '/');
      }
    };

    checkSubscriptionAndDonate();
  }, []);

  // Track supporter tier on mount
  useEffect(() => {
    const fetchSupporterTier = async () => {
      if (!token) return;

      try {
        const response = await fetch(`${API_URL}/user/visit`, {
          method: 'POST',
          credentials: 'include'
        });

        if (response.ok) {
          const data = await response.json();
          if (data.supporterTier) {
            setSupporterTier(data.supporterTier);
          }
        }
      } catch (err) {
        console.error('Failed to fetch supporter tier:', err);
      }
    };

    fetchSupporterTier();
  }, [token]);

  // Track unsaved changes
  useEffect(() => {
    const currentData = JSON.stringify({ content });
    if (currentData !== lastSavedContentRef.current) {
      setHasUnsavedChanges(true);
    }
  }, [content]);

  // Show "private draft" status when editing a previously published slate
  useEffect(() => {
    if (wasPublishedBeforeEdit && status === 'ready') {
      setStatus(strings.writer.status.privateDraft);
    }
  }, [wasPublishedBeforeEdit, status]);

  // Queued offline writes flush whenever the network is back
  useEffect(() => {
    if (!userId) return;
    watchConnectivity(userId);
    pruneCache(userId).catch(() => {});
  }, [userId]);

  // The open text became (or was renumbered to) this slate: hand the number
  // up without a reload and give the page the slate's own address
  const adoptSlate = (slate) => {
    adoptedSlateRef.current = slate.slate_number;
    onSlateChange(slate);
    const path = window.location.pathname;
    if (path === '/' || path.startsWith('/slate/')) window.history.replaceState({}, '', `/slate/${slate.slate_number}`);
  };

  // A local slate that got its number, or a merge that changed the open
  // slate: follow it without a reload
  useEffect(() => onSync((e) => {
    const open = currentSlate?.slate_number;
    if (e.type === 'synced' && open != null && open === e.from) {
      loadedSlateRef.current = { updated_at: e.slate.updated_at ?? null, encryptedContent: loadedSlateRef.current?.encryptedContent ?? null };
      adoptSlate({ ...currentSlate, ...e.slate, slate_number: e.to, local: false });
    } else if (e.type === 'merged' && open != null && open === e.slateNumber) {
      loadedSlateRef.current = { updated_at: e.updated_at ?? null, encryptedContent: e.encryptedContent ?? null };
      setContent(e.text);
      lastSavedContentRef.current = JSON.stringify({ content: e.text });
      setHasUnsavedChanges(false);
      setStatus(e.conflicts ? strings.writer.connectivity.conflicts(e.conflicts) : strings.writer.connectivity.merged);
      if (!e.conflicts) setTimeout(() => setStatus('ready'), 4000);
    } else if (e.type === 'flushed' && open != null && open === e.slateNumber && e.updated_at) {
      // A queued edit of the open slate reached the account: the next save
      // starts from that version
      loadedSlateRef.current = { updated_at: e.updated_at, encryptedContent: e.encryptedContent ?? loadedSlateRef.current?.encryptedContent ?? null };
    } else if (e.type === 'started') {
      setStatus(strings.writer.connectivity.syncing);
    } else if (e.type === 'finished' && !e.failed) {
      setStatus((prev) => prev === strings.writer.connectivity.syncing ? 'ready' : prev);
    }
  }), [currentSlate, onSlateChange]);

  // Auto-save
  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      if (hasUnsavedChanges && (content || (currentSlate && !shareUrl))) {
        if (!token) {
          // Not logged in - trigger header nudge instead of modal
          const wordCount = content.trim().split(/\s+/).length;
          const charCount = content.length;

          // Trigger nudge if user has written substantial content
          if ((wordCount >= 50 || charCount >= 250)) {
            if (window.triggerLoginNudge) {
              window.triggerLoginNudge();
            }
          }
        } else if (currentSlate) {
          // Logged in with existing slate - auto-save
          saveSlate();
        }
      }
    }, 2000);

    return () => clearTimeout(saveTimeoutRef.current);
  }, [content, hasUnsavedChanges, token, currentSlate, shareUrl]);

  // Cleanup nudge timeout on unmount
  useEffect(() => {
    return () => {
      if (nudgeTimeoutRef.current) {
        clearTimeout(nudgeTimeoutRef.current);
      }
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // ESC: Exit zen mode
      if (e.key === 'Escape' && zenMode) {
        e.preventDefault();
        setZenMode(false);
      }

      // Cmd/Ctrl + S: Save to account
      if (cmdOrCtrl && e.key === 's') {
        e.preventDefault();
        if (token) {
          saveSlate({ explicit: true });
        } else {
          onLogin();
        }
      }

      // Cmd/Ctrl + E: Open export menu
      if (cmdOrCtrl && e.key === 'e') {
        e.preventDefault();
        setShowExportMenu(true);
      }

      // Cmd/Ctrl + P: Export as PDF
      if (cmdOrCtrl && e.key === 'p') {
        e.preventDefault();
        exportToPdf();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [content, title, token, currentSlate]);

  // Tab-to-indent handler for textarea
  const handleTextareaKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();

    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const indent = '    '; // 4 spaces

    if (start === end) {
      // No selection — insert/remove indent at cursor
      if (e.shiftKey) {
        // Unindent current line
        const lineStart = content.lastIndexOf('\n', start - 1) + 1;
        const lineText = content.substring(lineStart, start);
        const spaces = lineText.match(/^ {1,4}/);
        if (spaces) {
          const removeCount = spaces[0].length;
          const newContent = content.substring(0, lineStart) + content.substring(lineStart + removeCount);
          setContent(newContent);
          requestAnimationFrame(() => {
            textarea.selectionStart = textarea.selectionEnd = start - removeCount;
          });
        }
      } else {
        // Insert indent at cursor
        const newContent = content.substring(0, start) + indent + content.substring(end);
        setContent(newContent);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + indent.length;
        });
      }
    } else {
      // Selection — indent/unindent all selected lines
      const lineStart = content.lastIndexOf('\n', start - 1) + 1;
      const selectedText = content.substring(lineStart, end);
      const lines = selectedText.split('\n');

      let newLines;
      let offset = 0;
      if (e.shiftKey) {
        newLines = lines.map(line => {
          const spaces = line.match(/^ {1,4}/);
          if (spaces) {
            offset -= spaces[0].length;
            return line.substring(spaces[0].length);
          }
          return line;
        });
      } else {
        newLines = lines.map(line => {
          offset += indent.length;
          return indent + line;
        });
      }

      const newContent = content.substring(0, lineStart) + newLines.join('\n') + content.substring(end);
      setContent(newContent);
      requestAnimationFrame(() => {
        textarea.selectionStart = lineStart;
        textarea.selectionEnd = lineStart + newLines.join('\n').length;
      });
    }
  };

  // Save before navigation (popstate/back/forward)
  useEffect(() => {
    const handlePopstate = async (e) => {
      if (hasUnsavedChanges && content.trim() && token && currentSlate) {
        e.preventDefault();
        await saveSlateSync();
      }
    };

    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  }, [hasUnsavedChanges, content, token, currentSlate]);

  // Per-document editor mode. Persisted on the slate for saved docs; for unsaved
  // drafts the preference rides along in localStorage until first save.
  const setEditorMode = (mode) => {
    setEditorModeState(mode);
    if (isShared) return; // view preference only — not ours to persist
    if (currentSlate && token) {
      fetch(`${API_URL}/slates/${currentSlate.slate_number}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ editorMode: mode }),
      }).catch(() => {});
    } else {
      localStorage.setItem('justtype-draft-mode', mode);
    }
  };

  const toggleEditorMode = () => setEditorMode(editorMode === 'wysiwyg' ? 'plain' : 'wysiwyg');

  const saveCaret = () => {
    const n = caretSlateRef.current;
    if (!userId || n == null || isLocalSlateNumber(n) || isScratchNumber(n)) return;
    let sel = null;
    if (editorMode === 'wysiwyg') sel = richEditorRef.current?.getSelection?.() || null;
    else if (textareaRef.current) sel = { anchor: textareaRef.current.selectionStart, head: textareaRef.current.selectionEnd };
    if (!sel) return;
    cacheSlate(userId, n, { caret: { ...sel, scroll: mainRef.current?.scrollTop || 0 } }).catch(() => {});
  };
  useEffect(() => {
    const t = setInterval(saveCaret, 15000);
    window.addEventListener('beforeunload', saveCaret);
    return () => { clearInterval(t); window.removeEventListener('beforeunload', saveCaret); };
  });
  // Keep the caret line in the middle while typing in the plain editor
  const centerIfWanted = () => {
    if (scrollMode !== 'centered') return;
    requestAnimationFrame(() => centerTextareaCaret(mainRef.current, textareaRef.current));
  };
  // The caret goes back where it was once the slate is on screen
  useEffect(() => {
    if (isLoading) return;
    const c = caretRestoreRef.current;
    if (!c || editorMode !== 'plain') return;
    const ta = textareaRef.current;
    if (!ta) return;
    const len = ta.value.length;
    if (c.end) { ta.setSelectionRange(len, len); ta.focus(); if (mainRef.current) mainRef.current.scrollTop = mainRef.current.scrollHeight; }
    else {
      ta.setSelectionRange(Math.min(c.anchor ?? len, len), Math.min(c.head ?? len, len));
      if (mainRef.current) mainRef.current.scrollTop = c.scroll || 0;
    }
    caretRestoreRef.current = null;
  }, [isLoading, editorMode, contentFadeKey]);

  const loadSlate = async (id) => {
    relockOthers(id);
    saveCaret();
    caretSlateRef.current = id;
    lastLoadedRef.current = id;
    if (isScratchNumber(id)) {
      // The scratch slate comes from this device alone
      const key = userId ? await getSlateKey(userId) : null;
      const { text } = await readScratch(userId, key);
      setCollabDocKey(null); setCollabSlateDbId(null); setLockDocKey(null); setIsLocked(false);
      lockedSlateRef.current = null;
      lockGateRef.current = null; setLockGate(null); setLockPrompt(null);
      caretRestoreRef.current = null;
      setTitle(strings.slates.scratch.title);
      setContent(text);
      setShareUrl(null);
      setWasPublishedBeforeEdit(false);
      lastSavedContentRef.current = JSON.stringify({ content: text });
      setHasUnsavedChanges(false);
      setStatus(strings.writer.status.scratch);
      setLoadingFadeOut(true);
      setContentFadeKey(prev => prev + 1);
      setTimeout(() => { setIsLoading(false); setLoadingFadeOut(false); }, 300);
      return;
    }
    try {
      // The device copy: the truth for slates created offline and for slates
      // with an edit still waiting to sync; the fallback when the network
      // fails. Everything else comes from the server and refreshes the copy.
      const cached = userId ? await getCachedSlate(userId, id).catch(() => null) : null;
      const pending = userId ? await getPendingFor(userId, id).catch(() => null) : null;
      let data = null;
      let fromCache = false;
      let gone = false;
      if (isLocalSlateNumber(id) || pending) {
        if (!cached?.data?.encryptedContent) throw new Error('local copy missing');
        data = cached.data;
        fromCache = true;
      } else {
        try {
          if (!isOnline()) throw new Error('offline');
          const response = await fetch(`${API_URL}/slates/${id}`, {
            credentials: 'include'
          });

          // Check if encryption key is missing (server restarted)
          if (response.status === 401) {
            const body = await response.json();
            if (body.code === 'ENCRYPTION_KEY_MISSING') {
              setIsLoading(false);
              onLogin();
              return;
            }
          }
          // Gone from the account, or in its trash: nothing to open, and
          // nothing to keep on the device
          if (response.status === 404 || response.status === 410) { gone = true; throw new Error('gone'); }
          if (!response.ok) throw new Error(`load ${response.status}`);
          data = await response.json();
          if (data.deleted_at) { gone = true; throw new Error('gone'); }
        } catch (netErr) {
          if (gone) {
            leaveGoneSlate(id);
            setContent('');
            setTitle('');
            setStatus('ready');
            setIsLoading(false);
            setLoadingFadeOut(false);
            return;
          }
          reportNetworkFailure();
          if (!cached?.data?.encryptedContent) {
            setStatus(strings.writer.connectivity.notAvailableOffline);
            setIsLoading(false);
            setLoadingFadeOut(false);
            return;
          }
          data = cached.data;
          fromCache = true;
        }
      }
      if (!fromCache && userId && data.encrypted) cacheSlate(userId, id, data, { opened: true }).catch(() => {});
      else if (cached && userId) cacheSlate(userId, id, {}, { opened: true }).catch(() => {});
      loadedSlateRef.current = { updated_at: data.updated_at ?? null, encryptedContent: data.encryptedContent ?? null };
      let slateContent;
      let slateTitle = data.title;
      let slateKey = null;
      let gated = false;
      if (data.encrypted && data.encryptedContent) {
        // E2E: decrypt client-side
        slateKey = await getSlateKey(userId);
        if (!slateKey) {
          setIsLoading(false);
          onLogin();
          return;
        }
        // Collaborative slate: content is under the shared doc key, which the
        // server returns wrapped to our master key.
        let contentKey = slateKey;
        let titleKey = slateKey;
        if (data.is_collab && data.collab_wrapped_key) {
          contentKey = await unwrapKey(data.collab_wrapped_key, slateKey);
          titleKey = contentKey;
          slateContent = await decryptContent(data.encryptedContent, contentKey);
          loadedContentRef.current = slateContent;
          setCollabDocKey(contentKey);
          setCollabSlateDbId(data.id);
          setLockDocKey(null);
          setIsLocked(false);
        } else if (data.is_locked && data.lock_wrapped_key) {
          // Locked slate: the content sits under its own doc key. With the
          // lock open it reads like any other; shut, the slate opens as far
          // as its title and the editor shows the lock instead.
          setCollabDocKey(null);
          setCollabSlateDbId(null);
          setIsLocked(true);
          lockedSlateRef.current = id;
          lockedSlateMetaRef.current = { lock_wrapped_key: data.lock_wrapped_key, lock_salt: data.lock_salt, lock_recovery_wrapped_key: data.lock_recovery_wrapped_key, lock_recovery_key_id: data.lock_recovery_key_id };
          const docKey = openDocKey(id);
          if (docKey) {
            contentKey = docKey;
            setLockDocKey(docKey);
            slateContent = await decryptContent(data.encryptedContent, contentKey);
            touchLock();
          } else {
            gated = true;
            setLockDocKey(null);
            slateContent = '';
          }
        } else {
          setCollabDocKey(null);
          setCollabSlateDbId(null);
          setLockDocKey(null);
          setIsLocked(false);
          lockedSlateRef.current = null;
          slateContent = await decryptContent(data.encryptedContent, contentKey);
        }
        // Decrypt title if encrypted
        if (data.encrypted_title && !data.is_published) {
          try {
            slateTitle = await decryptTitle(data.encrypted_title, titleKey);
          } catch (err) {
            console.error('Failed to decrypt title:', err);
            slateTitle = 'untitled slate';
          }
        }
      } else {
        slateContent = data.content;
        setCollabDocKey(null);
        setLockDocKey(null);
        setIsLocked(false);
      }

      // Two-way sync: adopt any newer edit a connected app made to this slate.
      // (Collab and locked slates are never app-shared — enforced server-side.)
      if (!fromCache && data.encrypted && slateKey && !data.is_published && !data.is_collab && !data.is_locked) {
        const merged = await pullAppEdits(id, slateKey);
        if (merged) {
          slateContent = merged.content;
          if (merged.title != null && merged.title.trim()) slateTitle = merged.title;
        }
      }

      setTitle(slateTitle);
      slateFactsRef.current = { created_at: data.created_at, updated_at: data.updated_at, tags: [] };
      if (data.encrypted_tags && slateKey) {
        decryptTags(data.encrypted_tags, collabDocKeyRefForTags(data, slateKey)).then(t => { slateFactsRef.current.tags = Array.isArray(t) ? t : []; }).catch(() => {});
      }
      if (!caretRestoreRef.current?.end) caretRestoreRef.current = cached?.data?.caret || null;
      if (caretRestoreRef.current && !caretRestoreRef.current.end) richEditorRef.current?.setNextSelection?.(caretRestoreRef.current);
      else if (caretRestoreRef.current?.end) richEditorRef.current?.setNextSelection?.({ anchor: slateContent.length });
      setContent(slateContent);
      const gate = gated ? { id, slate: data } : null;
      lockGateRef.current = gate;
      setLockGate(gate);
      setLockPrompt(null);
      setEditorModeState(data.editor_mode === 'wysiwyg' ? 'wysiwyg' : 'plain');
      setShareUrl(data.is_published ? `${window.location.origin}/s/${data.share_id}` : null);
      setShareInfo({ private: !!data.share_private, wrappedKey: data.share_wrapped_key || null, passSalt: data.share_pass_salt || null, passWrappedKey: data.share_pass_wrapped_key || null, expiresAt: data.share_expires_at || null });
      shareKeyRef.current = null;
      setShareLink(null);
      setSharePending(false);
      const isPreviouslyPublishedDraft = data.published_at && !data.is_published;
      setWasPublishedBeforeEdit(isPreviouslyPublishedDraft);
      lastSavedContentRef.current = JSON.stringify({ content: slateContent });
      setHasUnsavedChanges(false);
      setLoadingFadeOut(true);
      setContentFadeKey(prev => prev + 1);
      setTimeout(() => { setIsLoading(false); setLoadingFadeOut(false); }, 300);
    } catch (err) {
      console.error('Failed to load slate:', err);
      setIsLoading(false);
      setLoadingFadeOut(false);
    }
  };

  const handleStripeCheckout = async (tier, amount, email) => {
    try {
      setStatus('loading...');
      const body = { tier };
      if (amount) {
        body.amount = amount;
      }
      if (email) {
        body.email = email;
      }

      const response = await fetch(`${API_URL}/stripe/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (response.ok && data.url) {
        // Store tier for test upgrade after payment
        if (token) {
          localStorage.setItem('justtype-pending-tier', tier);
        }
        // Redirect to Stripe checkout
        window.location.href = data.url;
      } else {
        setStatus(data.error || 'failed to start checkout');
        setTimeout(() => setStatus('ready'), 3000);
      }
    } catch (err) {
      console.error('Stripe checkout error:', err);
      setStatus('checkout failed');
      setTimeout(() => setStatus('ready'), 3000);
    }
  };

  // Save before leaving the slate: same path as autosave
  const saveSlateSync = async () => {
    if (isShared || !token || !currentSlate) return;
    await saveSlate();
  };

  // Expose save function to parent via ref
  useImperativeHandle(ref, () => ({
    saveBeforeNavigate: async () => {
      if (hasUnsavedChanges && token && currentSlate) {
        await saveSlateSync();
      }
    },
    hasUnsavedChanges: () => hasUnsavedChanges,
    needsRepublish: () => wasPublishedBeforeEdit,
    getContent: () => content,
    setContent: (newContent) => setContent(newContent),
    clearContent: () => {
      setContent('');
      setTitle('');
      setHasUnsavedChanges(false);
      lastSavedContentRef.current = '';
      localStorage.removeItem('justtype-draft');
      setEditorModeState(localStorage.getItem('justtype-draft-mode') === 'wysiwyg' ? 'wysiwyg' : 'plain');
      setCollabDocKey(null);
      setCollabSlateDbId(null);
      setCollabPanel(null);
    },
    // Command palette methods
    saveSlate: () => saveSlate({ explicit: true }),
    toggleEditorMode: () => toggleEditorMode(),
    openPublishMenu: () => setSharePanel(true),
    openCollab: () => openCollab(),
    // Open the settings surface for this breakpoint and flag the new controls.
    revealNewFeatures: () => {
      const desktop = typeof window !== 'undefined'
        && window.matchMedia('(min-width: 768px)').matches;
      if (desktop) {
        if (!showSettingsMenu) handleToggleMenu();
      } else {
        setSheetDrag({ y: 0, dragging: false });
        setShowMobileMenu(true);
      }
      // Long enough to notice after the strip's own 500ms reveal, short enough
      // not to become permanent chrome.
      setHighlightNew(true);
      setTimeout(() => setHighlightNew(false), 6000);
    },
    openHistory: () => setCollabPanel('history'),
    exportAs: (format) => {
      // Behind its gate the slate's text is not here to export
      if (lockGateRef.current) { announceStatus(strings.writer.lock.exportLocked, 2500); return; }
      switch (format) {
        case 'txt': exportToTxt(); break;
        case 'md': exportToMarkdown(); break;
        case 'pdf': exportToPdf(); break;
        case 'html': exportToHtml(); break;
      }
    },
    setTheme: (themeId) => setTheme(themeId),
    setFocusMode: (mode) => setFocusMode(mode),
    // The next slate to open lands with its caret at the end
    requestCaretEnd: () => { caretRestoreRef.current = { end: true }; },
    // Tags for the slate the next first save creates
    setPendingTags: (tags) => { pendingTagsRef.current = tags; },
  }));

  // The sheet's grab handle behaves like a native one: it follows the finger
  // down, snaps back if you let go early, and dismisses past a third of its
  // height. Upward drags are clamped so it cannot be pulled off the top.
  const SHEET_DISMISS_PX = 90;
  const beginSheetDrag = (e) => {
    sheetDragRef.current = { startY: e.clientY, y: 0, dragging: true };
    setSheetDrag({ y: 0, dragging: true });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const moveSheetDrag = (e) => {
    if (!sheetDragRef.current.dragging) return;
    const raw = e.clientY - sheetDragRef.current.startY;
    // Downward the sheet tracks the finger exactly. Upward there is nothing to
    // reveal, so it resists: a damped, capped rubber band that springs back.
    const y = raw >= 0 ? raw : Math.max(-56, raw * 0.35);
    sheetDragRef.current.y = y;
    setSheetDrag({ y, dragging: true });
  };
  const endSheetDrag = () => {
    if (!sheetDragRef.current.dragging) return;
    const travelled = sheetDragRef.current.y;
    sheetDragRef.current.dragging = false;
    sheetTapSuppressed.current = Math.abs(travelled) > 4;
    setSheetDrag({ y: 0, dragging: false });
    if (travelled > SHEET_DISMISS_PX) setShowMobileMenu(false);
  };

  const openSheet = () => {
    setSheetDrag({ y: 0, dragging: false });
    setShowMobileMenu(true);
  };
  const beginTriggerSwipe = (e) => {
    triggerSwipeRef.current = { startY: e.clientY, active: true, opened: false };
    // Capture, or the pointer leaves this small pill within a few pixels and
    // the rest of the gesture is delivered somewhere else entirely.
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const moveTriggerSwipe = (e) => {
    const t = triggerSwipeRef.current;
    if (!t.active) return;
    if (t.startY - e.clientY > 20) {
      t.active = false;
      t.opened = true;
      openSheet();
    }
  };
  const endTriggerSwipe = (e) => {
    triggerSwipeRef.current.active = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const closeAbout = () => withViewTransition(() => setShowAboutModal(false));
  // Escape closes whatever overlay is on top. The hook keeps a stack, so a
  // confirm layered over the collab panel dismisses only itself.
  useEscape(showAboutModal, closeAbout);
  useEscape(showDonateModal, () => withViewTransition(() => setShowDonateModal(false)));
  useEscape(showPublishModal, () => withViewTransition(() => { setShowPublishModal(false); setLinkCopied(false); }));
  useEscape(showAlreadySubscribedModal, () => setShowAlreadySubscribedModal(false));
  useEscape(showExportMenu, () => setShowExportMenu(false));
  useEscape(showMobileMenu, () => setShowMobileMenu(false));
  useEscape(showPublishMenu, () => setShowPublishMenu(false));

  // Subscribing from the about card: bounce anonymous users to sign-in, and
  // send existing quarterly supporters to the "you already have this" card
  // rather than a second checkout.
  const handleSubscribeClick = async () => {
    if (!token) {
      setShowAboutModal(false);
      onOpenAuthModal();
      return;
    }
    try {
      const response = await fetch(`${API_URL}/account/storage`, { credentials: 'include' });
      const data = await response.json();
      if (response.ok && data.supporterTier === 'quarterly') {
        setShowAboutModal(false);
        setShowAlreadySubscribedModal(true);
        return;
      }
    } catch (err) {
      console.error('Failed to check subscription:', err);
    }
    handleStripeCheckout('quarterly');
  };

  // Opening collab on a slate that was never saved: the slate has to exist
  // server-side before anyone can be invited to it, so save it first and only
  // then open the panel. Shared slates already exist by definition.
  async function openCollab(tab = 'people') {
    if (!token) { onLogin(); return; }
    if (!currentSlate && !isShared) {
      if (!content.trim()) {
        // saveSlate() refuses an empty slate and returns null, which would look
        // like the button doing nothing at all.
        setStatus(strings.collab.needsContent);
        setTimeout(() => setStatus('ready'), 2500);
        return;
      }
      const saved = await saveSlate();
      if (!saved) return;
    }
    setCollabPanel(tab);
  }

  // The encrypted payload a save sends (collab slates encrypt under the
  // shared doc key; new slates are never collab). ZK titles: no plaintext
  // title leaves the browser for E2E slates.
  // A slate's first save gives it an address: 'saving...' morphs into the
  // address, which holds before the slot fades
  const setAnnouncingBoth = (on) => { announcingRef.current = on; setAnnouncing(on); };
  const holdAnnouncement = (ms, then) => {
    clearTimeout(announceRef.current);
    announceRef.current = setTimeout(() => { then?.(); setAnnouncingBoth(false); }, ms);
  };
  const announceStatus = (text, hold = 3500) => {
    setStatus(text);
    holdAnnouncement(hold, () => setStatus('ready'));
  };
  const endAnnouncement = () => { clearTimeout(announceRef.current); setAnnouncingBoth(false); };
  useEffect(() => () => clearTimeout(announceRef.current), []);

  const buildSavePayload = async () => {
    const firstLine = content.split('\n')[0].trim().replace(/^#{1,6}\s+/, '');
    const titleToSave = firstLine || 'untitled slate';
    const slateKey = userId ? await getSlateKey(userId) : null;
    // Collab: one shared key for both. Locked: the content under its doc
    // key, the title under the master key so the list keeps reading it.
    const contentKey = currentSlate ? (collabDocKey || lockDocKey || slateKey) : slateKey;
    const titleKey = currentSlate ? (collabDocKey || slateKey) : slateKey;
    let body;
    if (contentKey) {
      const encrypted = await encryptContent(content, contentKey);
      const encryptedTitleBlob = await encryptTitle(titleToSave, titleKey);
      const wordCount = content.trim() === '' ? 0 : content.trim().split(/\s+/).length;
      body = { encryptedTitle: encryptedTitleBlob, encryptedContent: encrypted, wordCount, charCount: content.length, sizeBytes: new TextEncoder().encode(content).length };
    } else {
      body = { title: titleToSave, content };
    }
    // New slates carry their editor mode; existing slates persist it via metadata PATCH
    if (!currentSlate) body.editorMode = editorMode;
    return { body, titleToSave, slateKey, contentKey };
  };

  // Offline, or the network fell over mid-save: the edit stays on this
  // device and syncs later. A new slate gets a local number until then.
  // Collab slates persist through the relay and are not queued here.
  const saveOffline = async (body) => {
    if (!userId || collabDocKey || !body.encryptedContent) return false;
    if (currentSlate) {
      await queueOfflineSave(userId, currentSlate.slate_number, body, loadedSlateRef.current ? { data: loadedSlateRef.current } : null);
    } else {
      const local = newSlateRefRef.current || newLocalSlateNumber();
      newSlateRefRef.current = null;
      await cacheSlate(userId, local, {
        slate_number: local, local: true, encrypted: true,
        encryptedContent: body.encryptedContent, encrypted_title: body.encryptedTitle,
        editor_mode: editorMode, is_published: 0, share_id: null, updated_at: null,
        word_count: body.wordCount, char_count: body.charCount,
      }, { opened: true });
      await queuePending(userId, local, { op: 'post', body, editorMode });
      adoptSlate({ slate_number: local, local: true });
    }
    lastSavedContentRef.current = JSON.stringify({ content });
    setHasUnsavedChanges(false);
    localStorage.removeItem('justtype-draft');
    setStatus(strings.writer.connectivity.savedLocally);
    return true;
  };

  // The slate is empty and saved: delete it and the writer is a blank page
  // again. A public slate asks first, and only when the user asked to save.
  const [showDeleteEmptyModal, setShowDeleteEmptyModal] = useState(false);
  const deleteEmptySlate = async ({ explicit = false } = {}) => {
    if (shareUrl) {
      if (explicit) setShowDeleteEmptyModal(true);
      return null;
    }
    return deleteCurrentSlate();
  };
  const deletingRef = useRef(null);
  // The slate is gone (deleted here, trashed from the list, or found gone
  // on load): its copy leaves the device and the writer is a blank page
  const leaveGoneSlate = (n) => {
    deleteCachedSlate(userId, n).catch(() => {});
    forgetHistory(userId, n);
    localStorage.removeItem('justtype-draft');
    lastSavedContentRef.current = '';
    loadedSlateRef.current = null;
    setHasUnsavedChanges(false);
    setShareUrl(null);
    setWasPublishedBeforeEdit(false);
    endAnnouncement();
    onSlateChange(null);
    if (window.location.pathname.startsWith('/slate/')) window.history.replaceState({}, '', '/');
  };
  const deleteCurrentSlate = async () => {
    const n = currentSlate?.slate_number;
    if (n == null || deletingRef.current === n) return null; // one delete in flight per slate
    deletingRef.current = n;
    setShowDeleteEmptyModal(false);
    try {
      const r = await fetch(`${API_URL}/slates/${n}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) { setStatus(saveFailedStatus()); return null; }
    } catch {
      reportNetworkFailure();
      setStatus(saveFailedStatus());
      return null;
    } finally {
      deletingRef.current = null;
    }
    leaveGoneSlate(n);
    announceStatus(strings.writer.status.deleted, 2000);
    return { deleted: true };
  };

  // Saves run one at a time. A leave-save that arrives while the autosave
  // is in flight waits for it and then finds nothing left to send, instead
  // of a second PUT on the same base version (which the server refuses as a
  // conflict and the editor would report as a merge).
  const saveChainRef = useRef(Promise.resolve());
  const saveSlate = (opts) => {
    const run = () => saveSlateNow(opts);
    const p = saveChainRef.current.then(run, run);
    saveChainRef.current = p.catch(() => {});
    return p;
  };

  // `explicit`: the user asked (cmd+s, the save button, the palette). It is
  // announced like a first save; the two-second autosave is not.
  const saveSlateNow = async ({ explicit = false } = {}) => {
    if (isShared) return null; // shared slates persist through the collab relay
    if (lockGateRef.current) return null; // a shut lock shows no content to save
    if (isScratch) {
      // Kept on this device, nothing leaves
      const key = userId ? await getSlateKey(userId) : null;
      if (!key) return null;
      if (JSON.stringify({ content }) === lastSavedContentRef.current) {
        if (explicit) { setStatus(strings.writer.status.savedHere); holdAnnouncement(2000, () => setStatus(strings.writer.status.scratch)); }
        return { unchanged: true, scratch: true };
      }
      await writeScratch(userId, key, content);
      lastSavedContentRef.current = JSON.stringify({ content });
      setHasUnsavedChanges(false);
      if (explicit) { setStatus(strings.writer.status.savedHere); holdAnnouncement(2000, () => setStatus(strings.writer.status.scratch)); }
      return { scratch: true };
    }
    const openNumber = currentSlate?.slate_number ?? null;
    const stillOpen = () => (currentSlateRef.current?.slate_number ?? null) === openNumber;
    if (!content.trim()) {
      // An emptied slate deletes itself; a public one asks first
      if (currentSlate && token && !collabDocKey && !isLocalSlateNumber(currentSlate.slate_number)) return deleteEmptySlate({ explicit });
      return null;
    }
    // Collab slates persist through the Yjs document, which lives on this
    // device too; the canonical blob catches up when the network is back
    if (collabDocKey && !isOnline()) {
      setStatus(strings.writer.connectivity.savedLocally);
      return null;
    }

    // Nothing changed since the last save (a queued leave-save behind an
    // autosave, or cmd+s twice): nothing to send
    if (currentSlate && JSON.stringify({ content }) === lastSavedContentRef.current) {
      if (explicit) announceStatus('saved', 2000);
      return { unchanged: true, slate_number: currentSlate.slate_number };
    }

    // An autosave that lands while an announcement is showing saves without
    // a word; the announcement keeps the slot
    const creating = !currentSlate;
    const loud = creating || explicit;
    const quiet = !loud && announcingRef.current;
    if (loud) setAnnouncingBoth(true);
    if (!quiet) setStatus('saving...');

    try {
      const { body, titleToSave, slateKey, contentKey } = await buildSavePayload();
      const method = currentSlate ? 'PUT' : 'POST';
      // A version of this text, when one is due, rides on the save
      let checkpoint = null;
      if (currentSlate && userId && contentKey && !collabDocKey && !isLocalSlateNumber(currentSlate.slate_number)) {
        try {
          checkpoint = await prepareCheckpoint({ userId, n: currentSlate.slate_number, text: content, key: contentKey, explicit });
        } catch (err) { console.warn('history: no version taken', err); }
        if (checkpoint) body.history = checkpoint.history;
      }
      const url = currentSlate
        ? `${API_URL}/slates/${currentSlate.slate_number}`
        : `${API_URL}/slates`;
      // Existing slates say which version their edits started from
      if (currentSlate && loadedSlateRef.current?.updated_at) body.baseUpdatedAt = loadedSlateRef.current.updated_at;
      if (!currentSlate) body.clientRef = (newSlateRefRef.current ||= newLocalSlateNumber());

      if ((!isOnline() || (currentSlate && isLocalSlateNumber(currentSlate.slate_number))) && await saveOffline(body)) { if (loud) holdAnnouncement(3000); return { local: true }; }

      const send = (payload) => fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      let response;
      try {
        response = await send(body);
      } catch (netErr) {
        reportNetworkFailure();
        if (await saveOffline(body)) { if (loud) holdAnnouncement(3000); return { local: true }; }
        throw netErr;
      }

      // Check if encryption key is missing (server restarted)
      if (response.status === 401) {
        const data = await response.json();
        if (data.code === 'ENCRYPTION_KEY_MISSING') {
          endAnnouncement();
          setStatus(strings.errors.sessionExpired);
          onLogin();
          return null;
        }
      }

      // The slate moved on since it was loaded (another device, an agent):
      // three-way merge and send the result. Regions both sides changed
      // become conflict blocks the editor renders with keep-mine/theirs.
      let sentBody = body;
      let mergeInfo = null;
      if (response.status === 409 && currentSlate && userId) {
        mergeInfo = await mergeWithServer(userId, currentSlate.slate_number, body, loadedSlateRef.current?.encryptedContent);
        sentBody = mergeInfo.body;
        response = await send(sentBody);
      }

      // No room for the version: the text goes up without it
      if (response.status === 413 && body.history) {
        const over = await response.clone().json().catch(() => ({}));
        if (over.code === 'HISTORY_OVER') {
          delete body.history;
          delete sentBody.history;
          checkpoint = null;
          response = await send(sentBody);
        }
      }

      // The server would not take it: the text is kept on this device and
      // the queued write retries when things are better
      if (!response.ok) {
        if (await saveOffline(body)) { if (loud) holdAnnouncement(3000); return { local: true }; }
        endAnnouncement();
        setStatus(saveFailedStatus());
        return null;
      }

      const data = await response.json();

      if (checkpoint && currentSlate) commitHistory(userId, currentSlate.slate_number, checkpoint.entries, checkpoint.blob);
      if (currentSlate && sentBody.encryptedContent) {
        if (stillOpen()) loadedSlateRef.current = { updated_at: data.updated_at ?? null, encryptedContent: sentBody.encryptedContent };
        cacheSlate(userId, currentSlate.slate_number, { encryptedContent: sentBody.encryptedContent, encrypted_title: sentBody.encryptedTitle, updated_at: data.updated_at ?? null }).catch(() => {});
      }
      if (mergeInfo) {
        // The merged text belongs to the slate that was saved; if another
        // one is open by now it stays out of the editor
        if (stillOpen()) {
          setContent(mergeInfo.text);
          lastSavedContentRef.current = JSON.stringify({ content: mergeInfo.text });
          setHasUnsavedChanges(false);
          setStatus(mergeInfo.conflicts ? strings.writer.connectivity.conflicts(mergeInfo.conflicts) : strings.writer.connectivity.merged);
          if (!mergeInfo.conflicts) setTimeout(() => setStatus('ready'), 4000);
          if (loud) holdAnnouncement(4000);
        } else endAnnouncement();
        return data;
      }

      if (!currentSlate) {
        newSlateRefRef.current = null;
        if (stillOpen()) loadedSlateRef.current = { updated_at: data.updated_at ?? null, encryptedContent: sentBody.encryptedContent ?? null };
        // The device copy a load would have made
        if (userId && sentBody.encryptedContent) {
          cacheSlate(userId, data.slate_number, {
            slate_number: data.slate_number, encrypted: true,
            encryptedContent: sentBody.encryptedContent, encrypted_title: sentBody.encryptedTitle,
            editor_mode: editorMode, is_published: 0, share_id: null, updated_at: data.updated_at ?? null,
            word_count: sentBody.wordCount, char_count: sentBody.charCount,
          }, { opened: true }).catch(() => {});
        }
        if (stillOpen()) adoptSlate(data);
        caretSlateRef.current = data.slate_number;
        if (pendingTagsRef.current && slateKey) {
          const tags = pendingTagsRef.current;
          pendingTagsRef.current = null;
          encryptTags(tags, slateKey)
            .then((encryptedTags) => fetch(`${API_URL}/slates/${data.slate_number}/metadata`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ encryptedTags }),
            }))
            .catch(() => {});
        }
      }

      // The user has moved on: the slate is saved, nothing else to show
      if (!stillOpen()) { endAnnouncement(); return data; }

      lastSavedContentRef.current = JSON.stringify({ content });
      setHasUnsavedChanges(false);

      // Keep any third-party shares of this slate in sync with the new content.
      // (Not for collab slates — they cannot be app-shared.)
      if (slateKey && !collabDocKey) {
        const slateNumber = currentSlate ? currentSlate.slate_number : data.slate_number;
        if (slateNumber != null) resyncSharedGrants(slateNumber, content, titleToSave, slateKey);
      }

      // Clear local draft since content is now saved to server
      localStorage.removeItem('justtype-draft');

      // Check if we should show support nudge (slate count is 3, 6, or 9)
      if (data.slateCount && (data.slateCount === 3 || data.slateCount === 6 || data.slateCount === 9)) {
        const nudgeKey = `support_nudge_shown_${data.slateCount}`;

        // Only show if we haven't shown this nudge before and user is not a supporter
        if (!localStorage.getItem(nudgeKey) && !supporterTier) {
          setTimeout(() => {
            setStatus(strings.nudges.support);
            setNudgeShown(true);
            localStorage.setItem(nudgeKey, 'true');

            // Hide after 20 seconds
            setTimeout(() => {
              setStatus('ready');
            }, 20000);
          }, 10000); // 10 seconds after save
        }
      }

      // A save you asked for, or the first one, gets its cue (autosave stays quiet)
      if (explicit || creating) cue('save');

      // Handle unpublishing due to edit
      if (data.was_unpublished) {
        setShareUrl(null);
        setWasPublishedBeforeEdit(true);
        setStatus(strings.writer.status.savedAsPrivate);
        setTimeout(() => setStatus(strings.writer.status.privateDraft), 3000);
        if (loud) holdAnnouncement(3000);
      } else if (data.is_published && data.share_id) {
        // System slates that stay published
        setShareUrl(`${window.location.origin}/s/${data.share_id}`);
        setStatus('saved');
        setTimeout(() => setStatus(strings.writer.status.published), 2000);
        if (loud) holdAnnouncement(2000);
      } else if (creating && data.slate_number != null) {
        announceStatus(strings.writer.status.savedAs(data.slate_number));
      } else if (explicit) {
        announceStatus('saved', 2000);
      } else if (!quiet) {
        setStatus('saved');
        setTimeout(() => setStatus('ready'), 2000);
      }

      return data; // Return the saved slate data
    } catch (err) {
      endAnnouncement();
      setStatus(saveFailedStatus());
      console.error('Save failed:', err);
      return null;
    }
  };

  // The link as the panel sees it
  const shareState = () => ({
    mode: shareUrl ? (shareInfo?.private ? 'private' : 'public') : 'off',
    openWith: sharePending ? 'passphrase' : (shareInfo?.passWrappedKey ? 'passphrase' : 'link'),
    expires: expiryChoice(shareInfo?.expiresAt),
    url: shareUrl ? (shareInfo?.private ? (shareInfo?.passWrappedKey ? shareUrl : shareLink) : shareUrl) : null,
    wasPublic: !!wasPublishedBeforeEdit || !!shareUrl,
    hasPassphrase: !!shareInfo?.passWrappedKey,
    busy: shareBusy,
  });
  // A private link's address needs its key: unwrapped once the slate is open
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!shareUrl || !shareInfo?.private || shareInfo?.passWrappedKey || !shareInfo?.wrappedKey || !userId) return;
      try {
        const master = await getSlateKey(userId);
        const key = shareKeyRef.current || await unwrapKey(shareInfo.wrappedKey, master);
        shareKeyRef.current = key;
        if (!cancelled) setShareLink(`${shareUrl}#${fragmentOf(key)}`);
      } catch (err) { console.warn('share key not opened', err); }
    })();
    return () => { cancelled = true; };
  }, [shareUrl, shareInfo, userId]);

  // One change to the link: its mode, how it opens, when it ends. Publishing
  // sends the copy the reader gets: plain text for a public link, title and
  // text encrypted under the share key for a private one.
  const applyShare = async (patch) => {
    if (!token) { onLogin(); return; }
    if (patch.pending) { setSharePending(true); return; }
    if (!currentSlate) {
      setStatus('saving...');
      const savedSlate = await saveSlate();
      if (!savedSlate) return;
      setStatus('slate saved! click share again to share it.');
      setTimeout(() => setStatus('ready'), 3000);
      return;
    }
    if (collabDocKey && !shareUrl && !wasPublishedBeforeEdit && patch.mode && patch.mode !== 'off') return;
    const cur = shareState();
    const next = {
      mode: patch.mode ?? (cur.mode === 'off' && (patch.openWith || patch.expires) ? (shareInfo?.private ? 'private' : 'public') : cur.mode),
      openWith: patch.openWith ?? cur.openWith,
      expires: patch.expires ?? cur.expires,
    };
    if (next.mode === 'off' && cur.mode === 'off' && !wasPublishedBeforeEdit) return;
    if (next.mode === 'public' && isLocked) { announceStatus(strings.writer.lock.publishBlockedHint, 2500); return; }
    if (next.mode === 'private' && next.openWith === 'passphrase' && !patch.passphrase && !shareInfo?.passWrappedKey) { setSharePending(true); return; }
    setShareBusy(true);
    try {
      if (hasUnsavedChanges) {
        setStatus('saving...');
        const savedSlate = await saveSlate();
        if (!savedSlate) return;
      }
      const master = userId ? await getSlateKey(userId) : null;
      const firstLine = content.split('\n')[0].trim().replace(/^#{1,6}\s+/, '') || 'untitled slate';
      const titleKey = collabDocKey || master;
      const body = {};
      if (next.mode === 'off') {
        body.isPublished = false;
        if (titleKey) body.encryptedTitle = await encryptTitle(firstLine, titleKey);
      } else {
        body.isPublished = true;
        body.share = { private: next.mode === 'private', expiresAt: expiryAt(next.expires) };
        if (next.mode === 'public') {
          if (master) { body.publicContent = content; body.publicTitle = firstLine; }
        } else {
          if (!master) throw new Error('no key');
          let key = shareKeyRef.current;
          if (!key && shareInfo?.wrappedKey) { try { key = await unwrapKey(shareInfo.wrappedKey, master); } catch { key = null; } }
          if (!key) key = await makeShareKey();
          shareKeyRef.current = key;
          body.publicContent = await encryptShare({ title: firstLine, text: content }, key);
          body.encryptedTitle = await encryptTitle(firstLine, titleKey);
          body.share.wrappedKey = await wrapKey(key, master);
          if (next.openWith === 'passphrase') {
            if (patch.passphrase) {
              const w = await wrapForPassphrase(key, patch.passphrase);
              body.share.passSalt = w.salt;
              body.share.passWrappedKey = w.wrappedKey;
            } else {
              body.share.passSalt = shareInfo.passSalt;
              body.share.passWrappedKey = shareInfo.passWrappedKey;
            }
          }
        }
      }
      const response = await fetch(`${API_URL}/slates/${currentSlate.slate_number}/publish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { announceStatus(String(data.error || strings.writer.share.failed).toLowerCase(), 2500); return; }
      if (next.mode === 'off') {
        setShareUrl(null);
        setWasPublishedBeforeEdit(false);
        setShareInfo({ private: !!shareInfo?.private, wrappedKey: null, passSalt: null, passWrappedKey: null, expiresAt: null });
        setShareLink(null);
        setStatus(strings.writer.status.unpublished);
        setTimeout(() => setStatus('ready'), 2000);
      } else {
        const wasOff = !shareUrl;
        setShareUrl(data.share_url);
        setWasPublishedBeforeEdit(false);
        const info = { private: next.mode === 'private', wrappedKey: body.share.wrappedKey || null, passSalt: body.share.passSalt || null, passWrappedKey: body.share.passWrappedKey || null, expiresAt: body.share.expiresAt || null };
        setShareInfo(info);
        const link = info.private && !info.passWrappedKey && shareKeyRef.current ? `${data.share_url}#${fragmentOf(shareKeyRef.current)}` : null;
        setShareLink(link);
        if (wasOff && !sharePanel) {
          setPublishModalUrl(link || data.share_url);
          setShowPublishModal(true);
        } else if (!wasOff) {
          setStatus(strings.writer.status.republished);
          setTimeout(() => setStatus('ready'), 2000);
        }
      }
      setSharePending(false);
    } catch (err) {
      console.error('share failed:', err);
      announceStatus(strings.writer.share.failed, 2500);
    } finally {
      setShareBusy(false);
    }
  };
  // The one-word paths (palette, the outdated word, the sheet): off, or back
  // the way it was shared last
  const handlePublish = () => applyShare({ mode: shareUrl ? 'off' : (shareInfo?.private ? 'private' : 'public') });

  // Complete unpublish: kill the share link for good and drop every trace of
  // having been public — the slate is plainly zero-knowledge private again.
  const handleForgetPublic = async () => {
    if (!currentSlate) return;
    try {
      const slateKey = userId ? await getSlateKey(userId) : null;
      const body = { isPublished: false, forget: true };
      const titleKey = collabDocKey || slateKey;
      if (titleKey) {
        const firstLine = content.split('\n')[0].trim().replace(/^#{1,6}\s+/, '');
        body.encryptedTitle = await encryptTitle(firstLine || 'untitled slate', titleKey);
      }
      const response = await fetch(`${API_URL}/slates/${currentSlate.slate_number}/publish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (response.ok) {
        setShareUrl(null);
        setWasPublishedBeforeEdit(false);
        setStatus(strings.writer.status.forgottenPublic);
        setTimeout(() => setStatus('ready'), 2500);
      } else {
        const data = await response.json().catch(() => ({}));
        setStatus(String(data.error || 'unpublish failed').toLowerCase());
        setTimeout(() => setStatus('ready'), 3000);
      }
      setShowPublishMenu(false);
    } catch (err) {
      console.error('Complete unpublish failed:', err);
      setStatus('unpublish failed');
      setTimeout(() => setStatus('ready'), 2000);
    }
  };

  const exportToTxt = () => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'slate'}-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowSaveMenu(false);
  };

  const exportToMarkdown = () => {
    const f = slateFactsRef.current || {};
    const blob = new Blob([markdownOf({ title, text: content, created: f.created_at, updated: f.updated_at, tags: f.tags || [] }, frontMatter)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'slate'}-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowSaveMenu(false);
  };

  const exportToHtml = () => {
    const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${escapeHtml(title || 'slate')}</title>\n<style>body{font-family:monospace;max-width:800px;margin:0 auto;padding:40px;line-height:1.6}pre{white-space:pre-wrap;word-wrap:break-word}</style>\n</head>\n<body>\n<pre>${escapeHtml(content)}</pre>\n</body>\n</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'slate'}-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowSaveMenu(false);
  };

  // Export as pdf = print. A print-only copy of the slate is mounted on body
  // (see the portal below and .print-root in index.css): rich slates print
  // the rendered view, math included, plain slates print the text. The
  // popup + document.write approach this replaces printed raw markdown,
  // broke on any `<` in the content and raced its own 250ms timer.
  const exportToPdf = () => {
    setShowSaveMenu(false);
    setShowExportMenu(false);
    setPrintJob(n => n + 1);
  };

  useEffect(() => {
    if (!printJob) return;
    let cancelled = false;
    document.body.dataset.printing = '';
    const done = () => setPrintJob(0);
    window.addEventListener('afterprint', done, { once: true });
    // Print once the copy has settled: lazy chunk mounted, math typeset,
    // fonts loaded. Bounded so a stuck chunk still gets a (plainer) print.
    (async () => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const root = document.querySelector('.print-root');
        if (root && !root.querySelector('.print-fallback, .cm-lp-math-pending')) break;
        await new Promise(r => setTimeout(r, 50));
      }
      await document.fonts?.ready;
      if (!cancelled) window.print();
    })();
    return () => {
      cancelled = true;
      delete document.body.dataset.printing;
      window.removeEventListener('afterprint', done);
    };
  }, [printJob]);

  const wordCount = content?.trim() === '' ? 0 : content?.trim().split(/\s+/).length || 0;
  const charCount = content?.length || 0;

  // Delayed hide for save menu
  const handleSaveMenuEnter = () => {
    if (saveMenuTimeoutRef.current) {
      clearTimeout(saveMenuTimeoutRef.current);
    }
    setShowSaveMenu(true);
  };

  const handleSaveMenuLeave = () => {
    saveMenuTimeoutRef.current = setTimeout(() => {
      setShowSaveMenu(false);
    }, 300);
  };

  const toggleTheme = () => {
    setShowThemePicker(!showThemePicker);
  };

  const selectTheme = (themeId) => {
    setTheme(themeId);
    setPreviewTheme(null);
    setShowThemePicker(false);
    // Sync to server if logged in
    if (token) {
      syncThemeToServer(themeId);
    }
  };

  const downloadExampleTheme = () => {
    const example = getExampleThemeJson();
    const blob = new Blob([JSON.stringify(example, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'example-theme.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleThemeImport = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        const result = addCustomTheme(json);
        if (result.success) {
          setTheme(json.id);
          setThemeImportError(null);
          setShowThemePicker(false);
          // Sync custom themes and selected theme to server
          if (token) {
            syncCustomThemesToServer();
            syncThemeToServer(json.id);
          }
        } else {
          setThemeImportError(result.errors.join(', '));
        }
      } catch (err) {
        setThemeImportError('invalid json file');
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be selected again
    event.target.value = '';
  };

  // Opening the picker asks where this person's submissions stand; closing
  // it folds the menus back
  useEffect(() => {
    if (!showThemePicker) { setThemeMenuId(null); setShowCatalog(false); return; }
    if (token) myThemeStates().then(setThemeStates).catch(() => {});
  }, [showThemePicker, token]);

  const handlePublishTheme = async (themeId) => {
    setPublishingTheme(themeId);
    setThemeImportError(null);
    try {
      const r = await publishTheme(getTheme(themeId), userId);
      setThemeStates((prev) => ({ ...prev, [r.slateNumber]: { status: r.status } }));
    } catch (err) {
      setThemeImportError(err.message);
    } finally {
      setPublishingTheme(null);
    }
  };

  const handleWithdrawTheme = async (themeId) => {
    try {
      const n = await withdrawTheme(themeId);
      setThemeStates((prev) => { const next = { ...prev }; delete next[n]; return next; });
    } catch (err) {
      setThemeImportError(err.message);
    }
  };

  const toggleCatalog = async () => {
    const next = !showCatalog;
    setShowCatalog(next);
    if (next && catalog === null) {
      try { setCatalog(await fetchCatalog()); } catch { setCatalog([]); }
    }
  };

  const handleUseCatalogTheme = (entry) => {
    const { author, shareId, ...catalogTheme } = entry;
    const result = addCustomTheme(catalogTheme);
    if (result.success) {
      setTheme(catalogTheme.id);
      setPreviewTheme(null);
      setShowThemePicker(false);
      if (token) {
        syncCustomThemesToServer();
        syncThemeToServer(catalogTheme.id);
      }
    } else {
      setThemeImportError(result.errors.join(', '));
    }
  };

  const handleDeleteTheme = (themeId) => {
    const result = removeCustomTheme(themeId);
    if (result.success) {
      forgetThemeSlate(themeId);
      if (theme === themeId) {
        setTheme('dark');
        if (token) syncThemeToServer('dark');
      }
      // Sync custom themes to server
      if (token) syncCustomThemesToServer();
    }
  };

  const cyclePunto = () => {
    setPunto(nextPunto(punto));
  };

  const cycleFocus = () => {
    const modes = ['off', 'on', 'auto'];
    const currentIndex = modes.indexOf(focusMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setFocusMode(modes[nextIndex]);
  };


  const themePickerPopover = showThemePicker && popoverAnchor && (
    <div data-theme-picker
      className="fixed rounded shadow-2xl overflow-hidden w-[260px] animate-[fadeInUp_0.15s_ease-out]"
      style={{ backgroundColor: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border)', left: popoverAnchor.left, bottom: popoverAnchor.bottom, zIndex: 200 }}
      onMouseLeave={() => setPreviewTheme(null)}
    >
      {/* Built-in themes */}
      {Object.keys(builtInThemes).filter(id => !hiddenThemes.includes(id)).map(themeId => (
        <button
          key={themeId}
          onClick={() => selectTheme(themeId)}
          onMouseEnter={() => setPreviewTheme(themeId)}
          className="w-full px-4 py-2 text-left transition-colors duration-200 text-sm"
          style={{
            color: theme === themeId ? 'var(--theme-accent)' : 'var(--theme-text-muted)',
            backgroundColor: 'transparent'
          }}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--theme-bg-tertiary)'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          {themeId}
        </button>
      ))}
      {/* Custom themes: each row has a menu for the catalog and deleting */}
      {getThemeIds().filter(id => isCustomTheme(id)).length > 0 && (
        <>
          <div style={{ borderTop: '1px solid var(--theme-border)', margin: '4px 0' }} />
          {getThemeIds().filter(id => isCustomTheme(id)).map(themeId => {
            const t = strings.writer.themeCatalog;
            const link = themeSlate(themeId);
            const state = link ? themeStates[link.slateNumber] : null;
            const open = themeMenuId === themeId;
            const stateColor = { approved: 'var(--theme-green)', rejected: 'var(--theme-red)', pending: 'var(--theme-orange)' };
            return (
              <div key={themeId}>
                <div className="flex items-center h-9">
                  <button
                    onClick={() => selectTheme(themeId)}
                    onMouseEnter={() => setPreviewTheme(themeId)}
                    className="flex-1 min-w-0 h-full px-4 text-left transition-colors duration-200 text-sm truncate hover:bg-[var(--theme-bg-tertiary)]"
                    style={{ color: theme === themeId ? 'var(--theme-accent)' : 'var(--theme-text-muted)' }}
                  >
                    {themeId}
                  </button>
                  {/* The dots carry the review state by colour; the word is
                      inside the menu */}
                  <button
                    onClick={() => setThemeMenuId(open ? null : themeId)}
                    onMouseEnter={() => setPreviewTheme(themeId)}
                    className="h-full px-3 text-sm transition-colors duration-200 hover:text-[var(--theme-text)]"
                    style={{ color: state?.status ? stateColor[state.status] : open ? 'var(--theme-text)' : 'var(--theme-text-dim)' }}
                    aria-label={t.more}
                  >
                    ···
                  </button>
                </div>
                {open && (
                  <div className="py-0.5 text-xs" style={{ backgroundColor: 'var(--theme-bg-tertiary)' }}>
                    {state?.status && (
                      <div className="px-4 py-1" style={{ color: stateColor[state.status] }}>{t[state.status]}{state.note ? ` · ${state.note}` : ''}</div>
                    )}
                    {token ? (
                      <button
                        onClick={() => handlePublishTheme(themeId)}
                        disabled={publishingTheme === themeId}
                        className="w-full px-4 py-1 text-left hover:bg-[var(--theme-bg-secondary)] disabled:opacity-60"
                        style={{ color: 'var(--theme-text-muted)' }}
                      >
                        {publishingTheme === themeId ? t.publishing : state?.status ? t.resubmit : t.publish}
                      </button>
                    ) : (
                      <div className="px-4 py-1" style={{ color: 'var(--theme-text-dim)' }}>{t.loginToPublish}</div>
                    )}
                    {token && state?.status && (
                      <button
                        onClick={() => handleWithdrawTheme(themeId)}
                        className="w-full px-4 py-1 text-left hover:bg-[var(--theme-bg-secondary)]"
                        style={{ color: 'var(--theme-text-muted)' }}
                      >
                        {t.withdraw}
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteTheme(themeId)}
                      className="w-full px-4 py-1 text-left hover:bg-[var(--theme-bg-secondary)] hover:text-[var(--theme-red)]"
                      style={{ color: 'var(--theme-text-dim)' }}
                    >
                      {t.delete}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
      {/* Import/Download buttons, and the catalog: other people's approved
          themes, previewed on hover */}
      <div style={{ borderTop: '1px solid var(--theme-border)', margin: '4px 0' }} />
      <button
        onClick={toggleCatalog}
        className="w-full px-4 py-2 text-left transition-colors duration-200 text-sm hover:bg-[var(--theme-bg-tertiary)]"
        style={{ color: 'var(--theme-text-muted)' }}
      >
        {showCatalog ? '– ' : '+ '}{strings.writer.themeCatalog.browse}
      </button>
      {showCatalog && (
        <div className="max-h-40 overflow-y-auto" style={{ backgroundColor: 'var(--theme-bg-tertiary)' }}>
          {catalog === null ? (
            <div className="px-4 py-1 text-xs" style={{ color: 'var(--theme-text-dim)' }}>{strings.writer.themeCatalog.loading}</div>
          ) : catalog.length === 0 ? (
            <div className="px-4 py-1 text-xs" style={{ color: 'var(--theme-text-dim)' }}>{strings.writer.themeCatalog.empty}</div>
          ) : catalog.map((entry) => (
            <button
              key={entry.shareId}
              onClick={() => handleUseCatalogTheme(entry)}
              onMouseEnter={() => setPreviewTheme(entry)}
              className="w-full px-4 py-1 text-left text-xs flex items-baseline justify-between gap-3 hover:bg-[var(--theme-bg-secondary)]"
              style={{ color: 'var(--theme-text-muted)' }}
            >
              <span className="truncate">{entry.name}</span>
              <span className="shrink-0" style={{ color: 'var(--theme-text-dim)' }}>{strings.writer.themeCatalog.by(entry.author)}</span>
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => themeFileInputRef.current?.click()}
        className="w-full px-4 py-2 text-left transition-colors duration-200 text-sm"
        style={{ color: 'var(--theme-text-muted)', backgroundColor: 'transparent' }}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--theme-bg-tertiary)'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        + import json
      </button>
      <button
        onClick={downloadExampleTheme}
        className="w-full px-4 py-2 text-left transition-colors duration-200 text-sm"
        style={{ color: 'var(--theme-text-dim)', backgroundColor: 'transparent' }}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--theme-bg-tertiary)'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        ↓ example.json
      </button>
      {/* Import error message */}
      {themeImportError && (
        <div className="px-4 py-2 text-xs" style={{ color: 'var(--theme-red)', borderTop: '1px solid var(--theme-border)' }}>
          {themeImportError}
        </div>
      )}
      {/* Hidden file input */}
      <input
        ref={themeFileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleThemeImport}
        className="hidden"
      />
    </div>
  );

  const publishPopover = showPublishMenu && popoverAnchor && (
    <div
      className="fixed bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded shadow-2xl overflow-hidden min-w-[160px] animate-[fadeInUp_0.15s_ease-out]"
      style={{ left: popoverAnchor.left, bottom: popoverAnchor.bottom, zIndex: 200 }}
    >
      {!shareUrl && !wasPublishedBeforeEdit && (
        (collabDocKey || isLocked) ? (
          // Collab slates cannot be published yet, locked ones stay
          // private. Greyed and inert; the label swaps on hover instead
          // of a native tooltip, matching the inline `sure?` style.
          <div
            className="group w-full px-4 py-2 text-left opacity-40 cursor-not-allowed select-none"
            title={isLocked ? strings.writer.lock.publishBlockedHint : strings.writer.collabState.publishBlockedHint}
          >
            <span className="group-hover:hidden">make public</span>
            <span className="hidden group-hover:inline">{isLocked ? strings.writer.lock.publishBlocked : strings.writer.collabState.publishBlocked}</span>
          </div>
        ) : (
          <button
            onClick={handlePublish}
            className="w-full px-4 py-2 text-left hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-colors duration-200"
          >
            make public
          </button>
        )
      )}
      {shareUrl && (
        <>
          <button
            onClick={() => {
              navigator.clipboard.writeText(shareUrl);
              setStatus(strings.writer.status.linkCopied);
              setTimeout(() => setStatus('ready'), 2000);
              setShowPublishMenu(false);
            }}
            className="w-full px-4 py-2 text-left hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-colors duration-200"
          >
            copy link
          </button>
          <button
            onClick={handlePublish}
            className="w-full px-4 py-2 text-left hover:bg-[var(--theme-bg-tertiary)] text-red-400 hover:text-red-300 transition-colors duration-200"
          >
            make private
          </button>
        </>
      )}
      {wasPublishedBeforeEdit && !shareUrl && (
        <button
          onClick={handlePublish}
          className="w-full px-4 py-2 text-left hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-colors duration-200"
        >
          update public version
        </button>
      )}
      {(shareUrl || wasPublishedBeforeEdit) && (
        <button
          onClick={() => {
            clearTimeout(forgetTimerRef.current);
            if (confirmForget) {
              setConfirmForget(false);
              handleForgetPublic();
            } else {
              setConfirmForget(true);
              forgetTimerRef.current = setTimeout(() => setConfirmForget(false), 3000);
            }
          }}
          title={strings.writer.publishMenu.forgetHint}
          className="w-full px-4 py-2 text-left hover:bg-[var(--theme-bg-tertiary)] text-red-400 hover:text-red-300 transition-colors duration-200"
        >
          {confirmForget ? strings.writer.publishMenu.forgetConfirm : strings.writer.publishMenu.forget}
        </button>
      )}
    </div>
  );

  // Slate lock. Locking re-keys the content under a fresh doc key wrapped to
  // the account's lock key and rides on a normal save; unlocking re-keys it
  // back to the master key. Runs on the save chain so it never races a save.
  const canLock = !!(token && currentSlate && !isShared && !isScratch && !collabDocKey && !shareUrl && !isLocalSlateNumber(currentSlate.slate_number));
  const rekeyForLock = async (lockOn, { secret = null, recoveryKey = null, docKey = null } = {}) => {
    const slateKey = userId ? await getSlateKey(userId) : null;
    if (!slateKey || !currentSlate) return;
    const { body, data, docKey: key } = await saveLockChange({
      userId, slateNumber: currentSlate.slate_number, content, masterKey: slateKey, lockOn, secret, recoveryKey, docKey,
    });
    loadedSlateRef.current = { updated_at: data.updated_at ?? null, encryptedContent: body.encryptedContent };
    lastSavedContentRef.current = JSON.stringify({ content });
    setHasUnsavedChanges(false);
    setLockDocKey(key);
    setIsLocked(lockOn);
    lockedSlateRef.current = lockOn ? currentSlate.slate_number : null;
    announceStatus(lockOn ? strings.writer.lock.locked : strings.writer.lock.unlocked, 2500);
  };
  const onSaveChain = (run) => {
    const p = saveChainRef.current.then(run, run);
    saveChainRef.current = p.catch(() => {});
    return p;
  };
  const toggleLock = async () => {
    if (!canLock || lockGate) return;
    if (!isLocked) {
      // Choosing a secret: the panel also asks for the login secret once
      // when the account has no lock-recovery keypair the login opens yet
      let info = null;
      try { info = await fetchLockRecovery(userId); } catch { announceStatus(strings.writer.lock.failed, 2500); return; }
      const recoveryKey = currentRecoveryKey(info);
      const needsLogin = !recoveryKey || !loginKindsOf(recoveryKey).length;
      if (needsLogin && !isOnline()) { announceStatus(strings.writer.lock.needsNetwork, 2500); return; }
      setLockPrompt({ info, recoveryKey, needsLogin });
      return;
    }
    try { await onSaveChain(() => rekeyForLock(false)); }
    catch (err) { console.error('lock toggle failed:', err); announceStatus(strings.writer.lock.failed, 2500); }
  };
  const handleLockPromptSubmit = async ({ secret, login }) => {
    let recoveryKey = lockPrompt?.recoveryKey || null;
    if (login) recoveryKey = await ensureLockRecovery({ login, info: lockPrompt?.info || null });
    setLockPrompt(null);
    await onSaveChain(() => rekeyForLock(true, { secret, recoveryKey }));
  };
  // The gate on a locked slate: open it with its secret, then load it again
  const handleLockGateSubmit = async ({ secret }) => {
    const gate = lockGateRef.current;
    if (!gate) return;
    await unlockSlate(gate.id, secret, gate.slate);
    lockGateRef.current = null;
    setLockGate(null);
    await loadSlate(gate.id);
  };
  // Forgot it: a small modal takes the password (or the pin, or the phrase);
  // what it opens is the doc key, and the lock comes off the slate
  const [lockRecover, setLockRecover] = useState(null); // { ways, info }
  const handleLockForgot = async () => {
    const gate = lockGateRef.current;
    if (!gate) return;
    try {
      const info = await fetchLockRecovery(userId);
      setLockRecover({ ways: recoveryWaysFor(gate.slate, info), info });
    } catch { announceStatus(strings.writer.lock.failed, 2500); }
  };
  const handleLockGateRecover = async ({ via }) => {
    const gate = lockGateRef.current;
    if (!gate) return;
    const info = lockRecover?.info || await fetchLockRecovery(userId);
    const docKey = await recoverSlate(gate.id, via, gate.slate, info);
    const slateKey = await getSlateKey(userId);
    const text = gate.slate.encryptedContent ? await decryptContent(gate.slate.encryptedContent, docKey) : '';
    await saveLockChange({ userId, slateNumber: gate.id, content: text, masterKey: slateKey, lockOn: false, baseUpdatedAt: gate.slate.updated_at ?? null });
    setLockRecover(null);
    lockGateRef.current = null;
    setLockGate(null);
    await loadSlate(gate.id);
    announceStatus(strings.writer.lock.recovered, 2500);
  };
  // Lock events for the open slate: the lock shut on its own (idle, logout)
  // hides the content behind the gate again; a change made from the list
  // (lock, remove lock) updates the editor's keys so its next save fits
  useEffect(() => onLockChange((ev) => {
    const n = currentSlate?.slate_number;
    if (n == null || String(ev.slateNumber) !== String(n)) return;
    if (ev.type === 'close') {
      if (!isLocked || lockGateRef.current) return;
      const shut = () => {
        const gate = { id: n, slate: { ...(loadedSlateRef.current || {}), is_locked: 1, lock_wrapped_key: lockedSlateMetaRef.current?.lock_wrapped_key, lock_salt: lockedSlateMetaRef.current?.lock_salt, lock_recovery_wrapped_key: lockedSlateMetaRef.current?.lock_recovery_wrapped_key, lock_recovery_key_id: lockedSlateMetaRef.current?.lock_recovery_key_id } };
        lockGateRef.current = gate;
        lastSavedContentRef.current = JSON.stringify({ content: '' });
        setContent('');
        setHasUnsavedChanges(false);
        setLockDocKey(null);
        setLockGate(gate);
      };
      if (hasUnsavedChanges) saveSlate().catch(() => {}).finally(shut);
      else shut();
    } else if (ev.type === 'locked' || ev.type === 'unlocked') {
      const on = ev.type === 'locked';
      setIsLocked(on);
      setLockDocKey(on ? openDocKey(n) : null);
      lockedSlateRef.current = on ? n : null;
      lockedSlateMetaRef.current = on ? ev.lockFields : null;
      if (loadedSlateRef.current) loadedSlateRef.current = { updated_at: ev.updatedAt ?? loadedSlateRef.current.updated_at, encryptedContent: ev.encryptedContent ?? loadedSlateRef.current.encryptedContent };
    }
  }), [isLocked, currentSlate, hasUnsavedChanges, content]);

  // Version history of a private slate, on or off per slate. The panel
  // reads versions through this source and turns them on (the text now is
  // the first version) or off (every version goes); restoring puts the old
  // text in the editor and saves it like any edit, after the text on screen
  // became a version itself.
  const historyKey = async () => lockDocKey || (userId ? await getSlateKey(userId) : null);
  const historySource = useMemo(() => {
    const n = currentSlate?.slate_number;
    const rows = (entries) => [...entries].reverse().map(e => ({ id: e.id, created_at: Math.floor(e.at / 1000), label: e.label || null }));
    return {
      list: async () => {
        const entries = await loadHistory(userId, n, await historyKey());
        if (!entries) throw new Error(strings.collab.history.unavailable);
        return rows(entries);
      },
      turnOn: async () => {
        const entries = await enableHistory({ userId, n, key: await historyKey(), text: contentRef.current });
        if (!entries) throw new Error(strings.collab.history.unavailable);
        return rows(entries);
      },
      turnOff: async () => rows(await disableHistory({ userId, n })),
      text: async (cp) => (heldHistory(userId, n) || []).find(e => e.id === cp.id)?.text ?? '',
      label: async (cp, name) => labelVersion({ userId, n, key: await historyKey(), id: cp.id, label: name }),
      emptyText: strings.collab.history.emptySolo,
    };
  }, [userId, currentSlate?.slate_number, lockDocKey]);
  const restoreAfterSetRef = useRef(false);
  useEffect(() => {
    if (!restoreAfterSetRef.current) return;
    restoreAfterSetRef.current = false;
    saveSlate({ explicit: true });
  }, [content]);
  const restoreVersion = async (text) => {
    const n = currentSlate?.slate_number;
    if (n == null || text === content) return;
    try {
      const before = await prepareCheckpoint({ userId, n, text: content, key: await historyKey(), force: true, reason: 'before restore' });
      if (before) commitHistory(userId, n, before.entries, before.blob);
    } catch (err) { console.warn('history: the text on screen was not kept', err); }
    restoreAfterSetRef.current = true;
    setContent(text);
    setHasUnsavedChanges(true);
  };
  const canHistory = !!(token && currentSlate && !isShared && !isScratch && !isLocalSlateNumber(currentSlate.slate_number) && !lockGate && (!collabDocKey || collabSlateDbId));

  // The settings row renders from one control model (see SettingsRow.jsx)
  const stripControls = {
    device: [
      { id: 'theme', label: 'theme', kind: 'menu', value: theme, options: getThemeIds(), onSet: selectTheme, onOpen: (e) => { anchorPopover(e); toggleTheme(); } },
      { id: 'size', label: 'size', kind: 'cycle', value: punto, options: PUNTO_SIZES, onCycle: cyclePunto, onSet: setPunto },
      { id: 'focus', label: 'focus', kind: 'cycle', value: focusMode === 'auto' ? 'smart' : focusMode, options: ['off', 'on', 'smart'], onCycle: cycleFocus, onSet: (v) => setFocusMode(v === 'smart' ? 'auto' : v) },
      { id: 'counter', label: 'counter', kind: 'toggle', value: showCounter ? 'on' : 'off', onCycle: () => setShowCounter(!showCounter), onSet: (v) => setShowCounter(v === 'on') },
    ],
    slate: [
      { id: 'editor', label: 'editor', kind: 'cycle', value: strings.writer.editorMode.value(editorMode), options: ['plain', 'rich'], onCycle: toggleEditorMode, onSet: (v) => setEditorMode(v === 'rich' ? 'wysiwyg' : 'plain'), pulse: highlightNew },
    ].filter(Boolean),
    actions: [
      token && !isScratch && { id: 'collab', label: strings.collab.menuButton, kind: 'action', onClick: () => { setSharePanel(false); openCollab('people'); }, active: !!collabDocKey, pulse: highlightNew },
      canHistory && { id: 'history', label: strings.collab.history.button, kind: 'action', onClick: () => setCollabPanel('history') },
      token && !isShared && !isScratch && { id: 'share', label: 'share', kind: 'action', onClick: () => { setCollabPanel(null); setSharePanel(true); }, active: !!shareUrl, activeColor: 'rgb(96 165 250)' },
    ].filter(Boolean),
  };

  // Focus mode: the footer chrome fades out and comes back under the pointer.
  // The about/save group also folds to zero width so the status slot sits at
  // the right edge, and glides back left as the group unfolds; the left
  // group slides the same way (tailwind moves it with `translate`, so that is
  // the property that transitions). The slide is a transform only while closed:
  // a transformed ancestor would pin the strip's fixed popovers.)
  const zenOpacity = zenMode ? 'opacity-0 group-hover:opacity-100' : 'opacity-100';
  const zenFade = `transition-opacity duration-500 ${zenOpacity}`;
  const chromeOpen = !zenMode || footerHover;

  return (
    <div className="relative flex flex-col bg-[var(--theme-bg)] h-full overflow-hidden">
      {/* LOADING OVERLAY */}
      {isLoading && (
        <div className={`absolute inset-0 bg-[var(--theme-bg)] flex items-center justify-center z-50 transition-opacity duration-300 ${loadingFadeOut ? 'opacity-0' : 'animate-[fadeIn_0.2s_ease-out]'}`}>
          <div className="text-[var(--theme-text-dim)] text-sm animate-pulse">loading slate...</div>
        </div>
      )}

      {/* WRITING AREA + COLLAB PANEL (a row, so the panel narrows the editor
          instead of covering the text you are comparing against) */}
      <div className="flex-grow flex min-h-0 w-full">
      <main ref={mainRef} key={contentFadeKey} className={`flex-1 min-w-0 flex justify-center bg-[var(--theme-bg)] overflow-y-auto ${contentFadeKey > 0 ? 'animate-[fadeIn_0.3s_ease-out]' : ''}`}>
        {lockGate || lockPrompt ? (
          <LockPanel
            key={lockGate ? `gate-${lockGate.id}` : 'setup'}
            className="w-full max-w-3xl"
            mode={lockGate ? 'gate' : 'setup'}
            needsLogin={!lockGate && lockPrompt.needsLogin}
            loginKind={loginKind()}
            ways={!lockGate && lockPrompt.recoveryKey ? waysOf(lockPrompt.recoveryKey) : null}
            onVerify={lockGate ? undefined : verifyLogin}
            onSubmit={lockGate ? handleLockGateSubmit : handleLockPromptSubmit}
            onForgot={lockGate && lockGate.slate?.lock_recovery_wrapped_key ? handleLockForgot : undefined}
            onCancel={lockGate ? undefined : () => setLockPrompt(null)}
          />
        ) : collabDocKey && collabSlateDbId ? (
          // Collaborative slate: one live CM6 surface for BOTH modes (remote
          // carets need it); `editorMode` only toggles the live preview.
          <React.Suspense fallback={<EditorSkeleton text={loadedContentRef.current} punto={punto} />}>
            <CollabEditorLazy
              key={`ce-${collabSlateDbId}-${collabKeyGen}`}
              slateId={collabSlateDbId}
              docKey={collabDocKey}
              onRekeyed={handleCollabRekeyed}
              apiRef={collabApiRef}
              username={localStorage.getItem('justtype-username')}
              mode={editorMode}
              initialContent={loadedContentRef.current}
              onChange={setContent}
              onRemoved={() => setSharedRemoved(true)}
              onError={isShared ? () => setSharedRemoved(true) : undefined}
              puntoClass={`punto-${punto}`}
            />
          </React.Suspense>
        ) : editorMode === 'wysiwyg' ? (
          <React.Suspense fallback={<EditorSkeleton text={content} punto={punto} />}>
            <TiptapEditor
              ref={richEditorRef}
              content={content}
              onChange={setContent}
              autofocus={!currentSlate}
              puntoClass={`punto-${punto}`}
              centerCaret={scrollMode === 'centered'}
              initialSelection={caretRestoreRef.current && !caretRestoreRef.current.end ? caretRestoreRef.current : null}
            />
          </React.Suspense>
        ) : (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            onKeyUp={centerIfWanted}
            onClick={centerIfWanted}
            onBlur={saveCaret}
            placeholder={strings.writer.contentPlaceholder}
            spellCheck={false}
            className={`w-full max-w-3xl bg-[var(--theme-bg)] border-none leading-relaxed resize-none p-8 focus:ring-0 placeholder-[var(--theme-text-dim)] text-[var(--theme-text)] punto-${punto}`}
          />
        )}
      </main>

      {printJob > 0 && createPortal(
        <div className={`print-root punto-${punto}`}>
          {title && <h1 className="print-title">{title}</h1>}
          {editorMode === 'wysiwyg' ? (
            <React.Suspense fallback={<pre className="print-fallback">{content}</pre>}>
              <MarkdownViewLazy content={content} puntoClass={`punto-${punto}`} />
            </React.Suspense>
          ) : (
            <pre>{content}</pre>
          )}
        </div>,
        document.body
      )}

      {lockRecover && lockGate && (
        <LockRecoverModal
          ways={lockRecover.ways}
          loginKind={loginKind()}
          onVerify={(via) => verifyRecoveryWay(lockGate.slate, via, lockRecover.info)}
          onRecover={handleLockGateRecover}
          onClose={() => setLockRecover(null)}
        />
      )}

      {sharePanel && currentSlate && !isShared && !isScratch && (
        <SharePanel
          share={shareState()}
          onChange={applyShare}
          onForget={handleForgetPublic}
          onClose={() => setSharePanel(false)}
        />
      )}

      {collabPanel && (currentSlate || isShared) && (
        <React.Suspense fallback={null}>
          <CollabPanelLazy
            tab={collabPanel}
            onTabChange={setCollabPanel}
            onClose={() => setCollabPanel(null)}
            solo={!collabDocKey && !isShared}
            historySource={!collabDocKey && !isShared ? historySource : null}
            canHistory={canHistory}
            slateId={collabSlateDbId}
            docKey={collabDocKey}
            currentText={content}
            getDoc={() => collabApiRef.current?.getDoc?.()}
            onRestore={(text) => {
              if (collabDocKey && collabApiRef.current) collabApiRef.current.replaceText(text);
              else restoreVersion(text);
              setCollabPanel(null);
            }}
            onOpenAsNewSlate={(text) => {
              setCollabPanel(null);
              if (onOpenAsNewSlate) onOpenAsNewSlate(text);
            }}
            shareProps={{
              slateNumber: currentSlate ? currentSlate.slate_number : null,
              userId,
              username: localStorage.getItem('justtype-username'),
              docKey: collabDocKey,
              memberView: isShared,
              sharedSlateId,
              onLeave: () => {
                setCollabPanel(null);
                window.history.pushState({}, '', '/slates');
                window.dispatchEvent(new PopStateEvent('popstate'));
              },
              getCurrent: () => ({
                content,
                title: (content.split('\n')[0].trim().replace(/^#{1,6}\s+/, '') || 'untitled slate')
              }),
              onDocKeyChange: (key, slateDbId) => {
                loadedContentRef.current = content;
                setCollabDocKey(key);
                setCollabKeyGen((g) => g + 1);
                // undefined = key rotation, same slate; null = collab disabled
                setCollabSlateDbId((prev) => (slateDbId === undefined ? prev : slateDbId));
                // The device copy follows: it is what an offline open reads
                if (userId && currentSlate) {
                  (async () => {
                    const master = await getSlateKey(userId);
                    if (!master) return;
                    const patch = key
                      ? { is_collab: 1, collab_wrapped_key: await wrapKey(key, master), ...(slateDbId ? { id: slateDbId } : {}) }
                      : { is_collab: 0, collab_wrapped_key: null };
                    await cacheSlate(userId, currentSlate.slate_number, patch);
                  })().catch(() => {});
                }
              },
              onClose: () => setCollabPanel(null),
            }}
          />
        </React.Suspense>
      )}
      </div>

      {/* DESKTOP FOOTER */}
      <footer className="hidden md:block px-8 py-4 border-t border-transparent bg-[var(--theme-bg)] relative group" onMouseEnter={() => setFooterHover(true)} onMouseLeave={() => setFooterHover(false)}>
        <div className="flex justify-between items-center gap-4 text-sm">

          {/* Left Controls */}
          <div className={`flex items-center gap-6 min-h-[32px] relative flex-1 min-w-0 ${zenOpacity} transition-[opacity,translate] duration-500 ease-out ${chromeOpen ? '' : '-translate-x-16'}`} ref={settingsMenuRef}>
            {/* Three dots button - animates to horizontal line when open */}
            <button
              ref={threeDotsRef}
              onClick={handleToggleMenu}
              className="opacity-50 hover:opacity-100 flex items-center justify-center w-8 h-8 rounded hover:bg-[var(--theme-bg-secondary)] relative transition-transform duration-500 ease-in-out"
              style={{
                zIndex: 100,
                transform: showSettingsMenu && !isMenuClosing ? `translateX(-${threeDotsTransform}px)` : 'translateX(0)'
              }}
              aria-label="Settings menu"
            >
              <svg className="w-5 h-5 transition-all duration-300" viewBox="0 0 24 24" fill="currentColor">
                {showSettingsMenu && !isMenuClosing ? (
                  // Horizontal line when open
                  <rect x="4" y="11" width="16" height="2" rx="1"/>
                ) : (
                  // Three dots when closed
                  <>
                    <circle cx="5" cy="12" r="2"/>
                    <circle cx="12" cy="12" r="2"/>
                    <circle cx="19" cy="12" r="2"/>
                  </>
                )}
              </svg>
            </button>

            {/* Menu buttons - appear after animation, slide in from three dots
                position. Bounded to the space before the right controls: on
                narrow windows the strip scrolls, fading out at the cutoff. */}
            {showMenuButton && (
              <>
                <div
                  ref={stripRef}
                  className={`settings-strip absolute left-12 right-0 overflow-x-auto flex items-center gap-2 ${stripFade.l ? 'strip-fade-l' : ''} ${stripFade.r ? 'strip-fade-r' : ''} ${isMenuClosing ? 'animate-[fadeOutToLeft_0.4s_ease-in_forwards]' : 'animate-[fadeInFromLeft_0.4s_ease-out_backwards]'}`}
                  style={{ zIndex: 150 }}
                  onScroll={() => {
                    setShowThemePicker(false);
                    setShowPublishMenu(false);
                    updateStripScroll();
                    const track = stripTrackRef.current;
                    if (track) {
                      track.classList.add('scrolling');
                      clearTimeout(stripScrollEndTimerRef.current);
                      stripScrollEndTimerRef.current = setTimeout(() => track.classList.remove('scrolling'), 600);
                    }
                  }}
                >
                  <SettingsRow controls={stripControls} />
                </div>
                {themePickerPopover}
              </>
            )}

            {/* Scroll hint for the strip: a slim thumb that appears only when
                the controls overflow, brightening while the user scrolls */}
            {showMenuButton && !isMenuClosing && (
              <div ref={stripTrackRef} className="strip-scrollbar" aria-hidden="true">
                <div ref={stripThumbRef} className="strip-scrollbar-thumb" />
              </div>
            )}

            {/* Counter - shown when enabled, fades when menu opens */}
            {showCounter && (
              <div className={`flex gap-4 ml-2 transition-opacity duration-500 ${showSettingsMenu ? 'opacity-0' : 'opacity-50'}`}>
                <TextMorph>{strings.writer.stats.words(wordCount)}</TextMorph>
                <TextMorph>{strings.writer.stats.chars(charCount)}</TextMorph>
              </div>
            )}
          </div>

          {/* Right Controls: the status slot keeps its place through focus
              mode (visible there only while a first save is announced) so
              the chrome fades in around it */}
          <div className="flex items-center">
            <span
              className={`transition-opacity duration-300 ${
                status !== 'ready' && (!zenMode || announcing) ? 'opacity-100' : 'opacity-0'
              } ${statusTone(shownStatus)} ${
                (status.includes('create account') || status.includes('support us')) ? 'cursor-pointer hover:text-white' : ''
              }`}
              onClick={() => {
                if (status.includes('create account')) {
                  onOpenAuthModal();
                } else if (status.includes('support us')) {
                  setShowDonateModal(true);
                }
              }}
            >
              <TextMorph>{shownStatus}</TextMorph>
            </span>

            <div className={`grid transition-[grid-template-columns] duration-500 ease-out ${chromeOpen ? 'grid-cols-[1fr]' : 'grid-cols-[0fr]'}`}>
            <div className={`min-w-0 whitespace-nowrap ${chromeSettled ? '' : 'overflow-hidden'} flex gap-4 items-center pl-4 ${zenFade}`}>

            {/* Connectivity, in the same voice as the status word: offline is
                orange like a private draft, a newer build is blue like a
                current public copy */}
            {!online && (
              <>
                <span className="text-orange-400" title={strings.writer.connectivity.offlineHint}>{strings.writer.connectivity.offline}</span>
                <span className="opacity-30">·</span>
              </>
            )}
            {online && updateAvailable && (
              <>
                <button
                  onClick={() => window.location.reload()}
                  className="text-blue-400 hover:text-white transition-colors duration-200"
                  title={strings.writer.connectivity.updateHint}
                >
                  {strings.writer.connectivity.update}
                </button>
                <span className="opacity-30">·</span>
              </>
            )}

            <button
              onClick={() => setShowAboutModal(true)}
              className="hover:text-white transition-colors duration-200"
            >
              {strings.writer.buttons.about}
            </button>

            {token && (
              <div className="relative flex items-center gap-3">
                {/* One compact publish indicator: blue when the public copy is
                    current (a click opens the share panel), orange when it
                    needs a sync (a click syncs) */}
                {shareUrl && !wasPublishedBeforeEdit && (
                  <button
                    onClick={() => { setCollabPanel(null); setSharePanel(true); }}
                    className="text-sm text-blue-400 hover:text-white transition-colors duration-200"
                  >
                    {strings.writer.publicState.current}
                  </button>
                )}
                {wasPublishedBeforeEdit && (
                  <button
                    onClick={handlePublish}
                    className="text-sm text-orange-400 hover:text-white transition-colors duration-200"
                    title={strings.writer.publicState.outdatedHint}
                  >
                    {strings.writer.publicState.outdated}
                  </button>
                )}

                {/* Devices connected directly (nearby): one click to the tab */}
                {nearbyCount > 0 && (
                  <button
                    onClick={() => setCollabPanel('nearby')}
                    className="text-sm text-violet-400 hover:text-white transition-colors duration-200"
                  >
                    {strings.collab.nearby.chip(nearbyCount)}
                  </button>
                )}

                {/* Collab slate (owner): mirrors the `public` chip, one click
                    to manage people. Both can show at once on a slate that was
                    published before it became collaborative. */}
                {!isShared && collabDocKey && (
                  <button
                    onClick={() => setCollabPanel('people')}
                    className="text-sm text-violet-400 hover:text-white transition-colors duration-200"
                    title={strings.writer.collabState.hint}
                  >
                    {strings.writer.collabState.label}
                  </button>
                )}

                {/* Shared slate: who owns it, and whether we lost access */}
                {isShared && sharedBy && !sharedRemoved && (
                  <button
                    onClick={() => setCollabPanel('people')}
                    className="text-sm text-[var(--theme-text-dim)] hover:text-white transition-colors duration-200"
                    title={strings.writer.collabState.sharedHint}
                  >
                    {strings.collab.viewer.sharedBy(sharedBy)}
                  </button>
                )}
                {isShared && sharedRemoved && (
                  <span className="text-sm" style={{ color: 'var(--theme-red)' }}>
                    {strings.collab.viewer.accessRemoved}
                  </span>
                )}

                {/* Who else is in this collab slate right now */}
                {collabPeers.length > 0 && (
                  <span
                    className="text-sm text-[var(--theme-green)]"
                    title={collabPeers.map(p => p.username).join(', ')}
                  >
                    {strings.collab.presence.here(collabPeers)}
                  </span>
                )}
              </div>
            )}

            <div className="relative">
              <button
                onMouseEnter={handleSaveMenuEnter}
                onMouseLeave={handleSaveMenuLeave}
                onClick={() => {
                  if (isShared) {
                    // Shared slates sync live — the button is a direct export
                    setShowExportMenu(true);
                    return;
                  }
                  if (!token) return;
                  if (!hasUnsavedChanges && currentSlate) {
                    // Already saved, just show status
                    announceStatus('saved', 2000);
                    return;
                  }
                  saveSlate({ explicit: true });
                }}
                className="kbd-host hover:text-white transition-all duration-300 active:scale-95 flex items-center"
              >
                <span>{isShared ? 'export' : strings.writer.buttons.save}</span>
                {token && !isShared && <span className="kbd-hint text-xs leading-none" aria-hidden="true">⌘S</span>}
              </button>
              {showSaveMenu && (
                <div
                  onMouseEnter={handleSaveMenuEnter}
                  onMouseLeave={handleSaveMenuLeave}
                  className="absolute bottom-full left-0 mb-2 animate-[fadeInUp_0.15s_ease-out]"
                >
                  {/* Flush left with the save word below it: no side padding,
                      anchored to the save button's left edge */}
                  <button
                    onClick={() => setShowExportMenu(true)}
                    className="kbd-host py-1.5 hover:text-white transition-colors duration-200 flex items-center whitespace-nowrap"
                  >
                    <span>export</span>
                    <span className="kbd-hint text-xs leading-none" aria-hidden="true">⌘E</span>
                  </button>
                </div>
              )}
            </div>
            </div>
            </div>
          </div>
        </div>
      </footer>

      {/* MOBILE TRIGGER
          Was an anonymous three-dot circle. It is a pill now: it carries the
          live word count, so the one number a writer wants on a phone is
          visible without opening anything, and the target is far easier to hit
          than a 24px glyph. Falls back to a plain menu glyph when the counter
          is switched off. */}
      <button
        onClick={() => {
          if (triggerSwipeRef.current.opened) { triggerSwipeRef.current.opened = false; return; }
          openSheet();
        }}
        onPointerDown={beginTriggerSwipe}
        onPointerMove={moveTriggerSwipe}
        onPointerUp={endTriggerSwipe}
        onPointerCancel={endTriggerSwipe}
        aria-label={strings.writer.mobile.open}
        className={`md:hidden fixed right-4 z-40 flex items-center gap-2 h-11 px-4 rounded-full bg-[var(--theme-bg-secondary)]/90 backdrop-blur border border-[var(--theme-border)] text-[var(--theme-text-muted)] shadow-lg active:scale-95 transition-all duration-200 touch-none ${
          showMobileMenu ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
        style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      >
        {showCounter && (
          <TextMorph className="text-sm tabular-nums">{strings.writer.mobile.words(wordCount)}</TextMorph>
        )}
        {hasUnsavedChanges && token && (
          <span className="w-1.5 h-1.5 rounded-full bg-orange-400" aria-hidden="true" />
        )}
        <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {/* MOBILE SHEET
          One scrollable sheet instead of three tabs. The toggles at the top are
          chips that flip in place without closing the sheet, so changing font
          size is one tap rather than open -> tab -> row. */}
      {showMobileMenu && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-40 animate-modal-overlay"
            onClick={() => setShowMobileMenu(false)}
          />
          <div
            className="md:hidden fixed bottom-0 left-0 right-0 bg-[var(--theme-bg-secondary)] border-t border-[var(--theme-border)] rounded-t-2xl z-50 max-h-[80vh] flex flex-col animate-[sheetUp_0.26s_cubic-bezier(0.16,1,0.3,1)]"
            style={{
              transform: sheetDrag.y ? `translateY(${sheetDrag.y}px)` : undefined,
              transition: sheetDrag.dragging ? 'none' : 'transform 0.24s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* grab handle: drag it down to dismiss, or just tap it */}
            <button
              onClick={() => {
                if (sheetTapSuppressed.current) { sheetTapSuppressed.current = false; return; }
                setShowMobileMenu(false);
              }}
              onPointerDown={beginSheetDrag}
              onPointerMove={moveSheetDrag}
              onPointerUp={endSheetDrag}
              onPointerCancel={endSheetDrag}
              aria-label={strings.writer.mobile.close}
              className="w-full pt-3 pb-3 flex justify-center shrink-0 cursor-grab active:cursor-grabbing touch-none"
            >
              <span className="block w-10 h-1 rounded-full bg-[var(--theme-text-dim)]" />
            </button>

            <div
              className="flex-1 overflow-y-auto no-native-scrollbar px-4 pb-4"
              style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
            >
              {/* counters */}
              {showCounter && (
                <div className="flex gap-3 mb-4">
                  <div className="flex-1 py-3 rounded-lg bg-[var(--theme-bg)] text-center">
                    <div className="text-xl text-white tabular-nums">{wordCount}</div>
                    <div className="text-[11px] text-[var(--theme-text-dim)] mt-0.5">words</div>
                  </div>
                  <div className="flex-1 py-3 rounded-lg bg-[var(--theme-bg)] text-center">
                    <div className="text-xl text-white tabular-nums">{charCount}</div>
                    <div className="text-[11px] text-[var(--theme-text-dim)] mt-0.5">chars</div>
                  </div>
                </div>
              )}

              {/* quick toggles: tapping one changes it in place */}
              <ScrollRow className="mb-4">
                {[...stripControls.device, ...stripControls.slate].map((c) => ({ key: c.id, label: controlLabel(c), onClick: c.kind === 'menu' ? c.onOpen : c.onCycle, highlight: c.pulse })).map((c) => (
                  <button
                    key={c.key}
                    onClick={c.onClick}
                    className={`shrink-0 h-9 px-3.5 rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg)] text-sm text-[var(--theme-text-muted)] active:bg-[var(--theme-bg-tertiary)] active:text-white transition-colors whitespace-nowrap ${c.highlight ? 'feature-pulse' : ''}`}
                  >
                    {c.label}
                  </button>
                ))}
              </ScrollRow>
              {/* The theme list opens from the chip; the desktop copy sits in
                  a footer that is display none here */}
              {themePickerPopover}

              {/* status */}
              {status !== 'ready' && (
                <div className={`mb-3 py-2 rounded-lg text-center text-sm ${statusTone(shownStatus)}`}>
                  <TextMorph>{shownStatus}</TextMorph>
                </div>
              )}
              {!online && (
                <div className="mb-3 py-2 rounded-lg text-center text-sm text-orange-400">{strings.writer.connectivity.offline}</div>
              )}
              {online && updateAvailable && (
                <button onClick={() => window.location.reload()} className="w-full mb-3 py-2 rounded-lg text-center text-sm text-blue-400">
                  {strings.writer.connectivity.update}
                </button>
              )}

              {/* primary action */}
              <button
                onClick={() => {
                  if (!token) {
                    onLogin();
                    setShowMobileMenu(false);
                    return;
                  }
                  if (isShared) {
                    setShowMobileMenu(false);
                    setShowExportMenu(true);
                    return;
                  }
                  if (!hasUnsavedChanges && currentSlate) {
                    announceStatus('saved', 2000);
                    return;
                  }
                  saveSlate({ explicit: true });
                }}
                className="w-full h-12 bg-white text-black rounded-lg active:bg-[#e5e5e5] transition-colors font-medium mb-4"
              >
                {isShared ? strings.writer.buttons.export : strings.writer.buttons.save}
              </button>

              {/* sharing (owner only — shared slates publish through their owner) */}
              {token && !isShared && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className="text-[11px] uppercase tracking-wider text-[var(--theme-text-dim)]">
                      {strings.writer.mobile.sections.sharing}
                    </span>
                    {collabDocKey && <span className="text-[11px] text-violet-400">{strings.writer.collabState.label}</span>}
                    {(shareUrl || wasPublishedBeforeEdit) && (
                      <span className={`text-[11px] ${wasPublishedBeforeEdit ? 'text-orange-400' : 'text-blue-400'}`}>
                        public{wasPublishedBeforeEdit ? ' · outdated' : ''}
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2">
                    {wasPublishedBeforeEdit && (
                      <button
                        onClick={handlePublish}
                        className="flex-1 h-11 bg-orange-900/30 text-orange-400 rounded-lg active:bg-orange-900/50 transition-colors text-sm"
                      >
                        sync
                      </button>
                    )}

                    {!shareUrl && !wasPublishedBeforeEdit && (
                      (collabDocKey || isLocked) ? (
                        <div className="flex-1 h-11 flex items-center justify-center bg-[var(--theme-bg)] rounded-lg text-sm opacity-40 select-none">
                          {isLocked ? strings.writer.lock.publishBlocked : strings.writer.collabState.publishBlocked}
                        </div>
                      ) : (
                        <button
                          onClick={handlePublish}
                          className="flex-1 h-11 bg-[var(--theme-bg)] rounded-lg active:bg-[var(--theme-bg-tertiary)] transition-colors text-sm"
                        >
                          make public
                        </button>
                      )
                    )}
                    {shareUrl && (
                      <>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(shareUrl);
                            setStatus(strings.writer.status.linkCopied);
                            setTimeout(() => setStatus('ready'), 2000);
                          }}
                          className="flex-1 h-11 bg-[var(--theme-bg)] rounded-lg active:bg-[var(--theme-bg-tertiary)] transition-colors text-sm"
                        >
                          copy link
                        </button>
                        <button
                          onClick={handlePublish}
                          className="h-11 px-4 bg-[var(--theme-bg)] text-red-400 rounded-lg active:bg-[var(--theme-bg-tertiary)] transition-colors text-sm"
                        >
                          private
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* everything else, as plain labelled rows */}
              <div className="rounded-lg overflow-hidden border border-[var(--theme-border)] divide-y divide-[var(--theme-border)]">
                {token && (
                  <SheetRow
                    label={strings.collab.menuButton}
                    value={collabDocKey ? 'on' : 'off'}
                    accent={collabDocKey ? 'text-violet-400' : undefined}
                    highlight={highlightNew}
                    onClick={() => { setShowMobileMenu(false); openCollab('people'); }}
                  />
                )}
                {canHistory && (
                  <SheetRow
                    label={strings.collab.history.button}
                    onClick={() => { setShowMobileMenu(false); setCollabPanel('history'); }}
                  />
                )}
                <SheetRow
                  label={strings.writer.mobile.exportSlate}
                  onClick={() => { setShowMobileMenu(false); setShowExportMenu(true); }}
                />
                <SheetRow
                  label={strings.writer.buttons.about}
                  onClick={() => { setShowMobileMenu(false); setShowAboutModal(true); }}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* ABOUT MODAL */}
      {showAboutModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md flex items-start justify-center z-50 p-4 overflow-y-auto animate-modal-overlay" onClick={closeAbout}>
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded-lg w-full max-w-md my-auto animate-modal-content overflow-hidden" onClick={e => e.stopPropagation()}>

            {/* head: title and a corner dismiss, so the card does not end in a
                full-width button that competes with the support actions */}
            <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-5">
              <div>
                <h2 className="text-lg text-white">{strings.writer.about.title}</h2>
                <p className="text-sm text-[var(--theme-text-muted)] mt-1.5 leading-relaxed">
                  {strings.writer.about.description}
                </p>
              </div>
              <button
                onClick={closeAbout}
                aria-label={strings.writer.about.close}
                className="shrink-0 -mr-1 -mt-1 w-8 h-8 rounded flex items-center justify-center text-[var(--theme-text-dim)] hover:text-white hover:bg-[var(--theme-bg-tertiary)] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {/* the one fact worth pulling out of the prose */}
            <div className="mx-6 mb-5 rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3">
              <div className="text-xs text-green-500 mb-1.5">{strings.writer.about.encryptionLabel}</div>
              <p className="text-xs text-[var(--theme-text-dim)] leading-relaxed">{strings.writer.about.encryption}</p>
            </div>

            {/* the links, in prose */}
            <div className="px-6 pb-5 space-y-3 text-xs text-[var(--theme-text-muted)] leading-relaxed">
              <p>
                read our <AboutLink href="/terms">{strings.writer.about.links.terms}</AboutLink> and{' '}
                <AboutLink href="/privacy">{strings.writer.about.links.privacy}</AboutLink>, or learn more about{' '}
                <AboutLink href="/project">{strings.writer.about.links.project}</AboutLink> on{' '}
                <AboutLink href="https://github.com/alfaoz/justtype">{strings.writer.about.links.github}</AboutLink>.
                got thoughts? <AboutLink href="/feedback">{strings.writer.about.links.feedback}</AboutLink>.
              </p>
              <p>
                see <AboutLink href="/whats-new">{strings.writer.about.links.whatsNew}</AboutLink>.
              </p>
              <p>
                {strings.writer.about.byline}{' '}
                <AboutLink href="https://alfaoz.dev">alfaoz</AboutLink>
              </p>
            </div>

            {/* support */}
            <div className="px-6 py-5 border-t border-[var(--theme-border)] bg-[var(--theme-bg)]">
              <p className="text-xs text-[var(--theme-text-dim)] leading-relaxed mb-4">
                {strings.writer.about.support.body}{' '}
                <a href="/limits" target="_blank" rel="noopener noreferrer" className="text-[var(--theme-text-muted)] hover:text-white underline underline-offset-2 transition-colors">
                  {strings.writer.about.support.limits}
                </a>.
              </p>
              <SupportButtons
                disabled
                onDonate={() => { setShowAboutModal(false); setShowDonateModal(true); }}
                onSubscribe={handleSubscribeClick}
              />
            </div>

            {/* colophon */}
            <div className="px-6 py-3.5 border-t border-[var(--theme-border)] flex items-center gap-2 flex-wrap text-[11px] text-[var(--theme-text-dim)]">
              {/* 4.2.0 gets one word on hover, and only 4.2.0 */}
              {VERSION.startsWith('4.2.0') ? (
                <HoverNote plain note={strings.writer.about.versionNote} className="whitespace-nowrap">{strings.writer.about.version(VERSION)}</HoverNote>
              ) : (
                <span className="whitespace-nowrap">{strings.writer.about.version(VERSION)}</span>
              )}
              <span className="opacity-40">·</span>
              <VerifyBadge className="text-[var(--theme-text-dim)] hover:text-white transition-colors">verify</VerifyBadge>
              <span className="opacity-40">·</span>
              <a href="/status" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">status</a>
              <span className="opacity-40">·</span>
              <a href="/dev" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">developers</a>
            </div>
          </div>
        </div>
      )}

      {/* PUBLISH MODAL */}
      {showPublishModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={() => withViewTransition(() => {
          setShowPublishModal(false);
          setLinkCopied(false);
        })}>
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded animate-modal-content p-6 md:p-8 max-w-md w-full my-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg md:text-xl text-white mb-4">your slate is now public!</h2>
            <p className="text-sm text-[var(--theme-text-muted)] mb-4">anyone with this link can view your slate:</p>
            <div className="bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded p-3 mb-6 break-all text-sm text-blue-400">
              {publishModalUrl}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(publishModalUrl);
                  setStatus(strings.writer.status.linkCopied);
                  setLinkCopied(true);
                  setTimeout(() => setStatus('ready'), 2000);
                  setTimeout(() => setLinkCopied(false), 2000);
                }}
                className="flex-1 bg-white text-black py-2 md:py-3 rounded hover:bg-[#e5e5e5] transition-all text-sm font-medium relative overflow-hidden"
              >
                <span className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${linkCopied ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full'}`}>
                  copied!
                </span>
                <span className={`transition-all duration-300 ${linkCopied ? 'opacity-0 translate-y-full' : 'opacity-100 translate-y-0'}`}>
                  copy link
                </span>
              </button>
              <button
                onClick={() => withViewTransition(() => {
                  setShowPublishModal(false);
                  setLinkCopied(false);
                })}
                className="flex-1 border border-[var(--theme-border)] py-2 md:py-3 rounded hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-all text-sm"
              >
                okay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DONATE MODAL */}
      {showDonateModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={() => withViewTransition(() => setShowDonateModal(false))}>
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded animate-modal-content p-6 md:p-8 max-w-md w-full my-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg md:text-xl text-white mb-4">support justtype</h2>
            <p className="text-sm text-[var(--theme-text-muted)] mb-4">enter an amount in EUR (minimum 1, recommended 3):</p>
            <input
              type="number"
              min="1"
              step="0.01"
              value={donateAmount}
              onChange={(e) => setDonateAmount(e.target.value)}
              className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-4 py-3 focus:outline-none focus:border-[var(--theme-text-dim)] text-white text-sm mb-4"
              autoFocus
            />
            {!token && (
              <>
                <p className="text-sm text-[var(--theme-text-muted)] mb-2">your email:</p>
                <input
                  type="email"
                  value={donateEmail}
                  onChange={(e) => setDonateEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-4 py-3 focus:outline-none focus:border-[var(--theme-text-dim)] text-white text-sm mb-4"
                />
                <p className="text-xs text-[var(--theme-text-dim)] mb-4">
                  note: you can donate without an account, but you won't get storage benefits until you sign up and link your payment
                </p>
              </>
            )}
            {token && <div className="mb-4" />}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  const amount = parseFloat(donateAmount);
                  if (amount >= 1 && (token || donateEmail.trim())) {
                    setShowDonateModal(false);
                    handleStripeCheckout('one_time', donateAmount, donateEmail);
                  }
                }}
                disabled={parseFloat(donateAmount) < 1 || (!token && !donateEmail.trim())}
                className="flex-1 bg-white text-black py-2 md:py-3 rounded hover:bg-[#e5e5e5] transition-all text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                donate
              </button>
              <button
                onClick={() => withViewTransition(() => setShowDonateModal(false))}
                className="flex-1 border border-[var(--theme-border)] py-2 md:py-3 rounded hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-all text-sm"
              >
                cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Already Subscribed Modal */}
      {showDeleteEmptyModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={() => withViewTransition(() => setShowDeleteEmptyModal(false))}>
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded animate-modal-content p-6 md:p-8 max-w-md w-full my-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg md:text-xl text-white mb-4">{strings.writer.deleteEmpty.title}</h2>
            <p className="text-sm text-[var(--theme-text-muted)] mb-6">{strings.writer.deleteEmpty.message}</p>
            <div className="flex gap-3">
              <button
                onClick={deleteCurrentSlate}
                className="flex-1 bg-white text-black py-2 md:py-3 rounded hover:bg-[#e5e5e5] transition-all text-sm font-medium"
              >
                {strings.writer.deleteEmpty.confirm}
              </button>
              <button
                onClick={() => withViewTransition(() => setShowDeleteEmptyModal(false))}
                className="flex-1 border border-[var(--theme-border)] py-2 md:py-3 rounded hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-all text-sm"
              >
                {strings.writer.deleteEmpty.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAlreadySubscribedModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={() => withViewTransition(() => setShowAlreadySubscribedModal(false))}>
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded animate-modal-content p-6 md:p-8 max-w-md w-full my-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg md:text-xl text-white mb-4">{strings.subscription.alreadySubscribed.title}</h2>
            <p className="text-sm text-[var(--theme-text-muted)] mb-6">
              {strings.subscription.alreadySubscribed.message}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowAlreadySubscribedModal(false);
                  window.location.href = '/manage-subscription';
                }}
                className="flex-1 bg-white text-black py-2 md:py-3 rounded hover:bg-[#e5e5e5] transition-all text-sm font-medium"
              >
                {strings.subscription.alreadySubscribed.manageButton}
              </button>
              <button
                onClick={() => withViewTransition(() => setShowAlreadySubscribedModal(false))}
                className="flex-1 border border-[var(--theme-border)] py-2 md:py-3 rounded hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-all text-sm"
              >
                {strings.subscription.alreadySubscribed.closeButton}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportMenu && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={() => setShowExportMenu(false)}>
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded animate-modal-content p-6 md:p-8 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg md:text-xl text-white mb-6">export slate</h2>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  exportToTxt();
                  setShowExportMenu(false);
                }}
                className="w-full p-4 bg-[var(--theme-bg-tertiary)] rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors text-left"
              >
                {strings.writer.buttons.exportTxt}
              </button>
              <button
                onClick={() => {
                  exportToMarkdown();
                  setShowExportMenu(false);
                }}
                className="w-full p-4 bg-[var(--theme-bg-tertiary)] rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors text-left"
              >
                {strings.writer.buttons.exportMd}
              </button>
              <button
                onClick={() => {
                  exportToPdf();
                  setShowExportMenu(false);
                }}
                className="w-full p-4 bg-[var(--theme-bg-tertiary)] rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors text-left"
              >
                {strings.writer.buttons.exportPdf}
              </button>
              <button
                onClick={() => setFrontMatter(nextFrontMatter(frontMatter))}
                className="text-xs text-[var(--theme-text-dim)] hover:text-[var(--theme-text)] transition-colors text-left px-1"
              >
                {strings.writer.buttons.frontMatter}: {frontMatter}
              </button>
            </div>
            <button
              onClick={() => setShowExportMenu(false)}
              className="mt-6 w-full border border-[var(--theme-border)] py-2 md:py-3 rounded hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-all text-sm"
            >
              cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
