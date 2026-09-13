import React, { useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';
import { decryptContent, decryptTags, decryptTitle, encryptTags, encryptTitle, unwrapKey } from '../crypto';
import { useConnectivity, isOnline, reportNetworkFailure } from '../connectivity';
import { cacheList, getCachedList, getCachedSlates, getCachedSlate, getPending, cacheSlate, setKeepOffline, offloadSlate, isLocalSlateNumber, pruneCache, copyPlan, dropStaleCopies } from '../offlineStore';
import { onSync } from '../offlineSync';
import { HoverNote } from './HoverNote';
import { MarkGlyph } from './MarkGlyph';
import { getSlateKey } from '../keyStore';
import { fetchInvites, acceptInvite, declineInvite, fetchSharedSlates, leaveSharedSlate } from '../collab';
import { useToast } from './Toast';
import { withViewTransition } from '../viewTransition';
import { useEscape } from '../useEscape';
import { TextMorph } from './TextMorph';
import { ChoiceRow } from './ChoiceRow';
import { PinIcon, UnpinIcon, TagIcon, CloudDownIcon, CloudOffIcon, GlobeIcon, EyeOffIcon, LockIcon, UnlockIcon, ArchiveIcon, UnarchiveIcon, TrashIcon, LeaveIcon } from './icons';
import { indexDevice, indexDeeper, findIn, isIndexed } from '../contentSearch';
import { isOpen, openDocKey, forgetDocKey, onLockChange, fetchLockRecovery, currentRecoveryKey, ensureLockRecovery, loginKind, loginKindsOf, waysOf, recoveryWaysFor, verifyLogin, verifyRecoveryWay, unlockSlate, recoverSlate, saveLockChange } from '../slateLock';
import { LockPanel } from './LockPanel';
import { LockRecoverModal } from './LockRecoverModal';

const TAG_REGEX = /^[a-z0-9]+$/;
const MAX_TAG_LENGTH = 24;
const MAX_TAGS_PER_SLATE = 20;

const ALL_APPS = '__all__';
const ALL_TAGS = '__all__';

const formatDateShort = (dateString) =>
  new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// The status vocabulary: one quiet lowercase word per state, coloured the way
// the rest of the app already speaks (blue = public, orange = was public,
// accent = shared with me). Private is the default state, so it stays dim.
const statusFor = (slate) =>
  slate.deleted_at
    ? { label: strings.slates.status.inTrash, cls: 'text-[var(--theme-text-dim)]' }
  : slate.shared
    ? { label: strings.collab.shared.by(slate.owner), cls: 'text-[var(--theme-accent)]' }
    : slate.is_locked
      ? slate.unlockedHere
        ? { label: strings.slates.status.unlocked, cls: 'text-[var(--theme-text-muted)]' }
        : { label: strings.slates.status.locked, cls: 'text-[var(--theme-text-muted)]' }
    : slate.is_published
      ? { label: strings.slates.status.public, cls: 'text-[var(--theme-blue)]' }
      : slate.published_at
        ? { label: strings.slates.status.wasPublic, cls: 'text-[var(--theme-orange)]' }
        : { label: strings.slates.status.private, cls: 'text-[var(--theme-text-dim)]' };

const SORT_OPTIONS = [
  { id: 'recent', label: strings.slates.sortOptions.recent },
  { id: 'oldest', label: strings.slates.sortOptions.oldest },
  { id: 'a-z', label: strings.slates.sortOptions.az },
  { id: 'z-a', label: strings.slates.sortOptions.za },
  { id: 'words', label: strings.slates.sortOptions.words },
];

/**
 * One quiet line of text choices (sort, show, from app). The active option is
 * underlined in the accent colour instead of sitting in a bordered chip, so
 * five sort orders and two filters stop reading as a wall of buttons.
 */
/**
 * The word-cluster a slate carries around: status, sync/collab/app markers and
 * clickable tags. Plain coloured words instead of bordered chips; tags wear a
 * # so they stay recognisable (and pressable) without a box around them.
 * The parent supplies flex, gap and text size.
 */
function SlateBadges({ slate, offline = false, onCopy, onKeep, markLast = false }) {
  const status = statusFor(slate);
  // Whether a copy of this slate is on this device. The mark hides until
  // hovered, so on a card it goes last, after collab and the tags, where its
  // space is the end of the line rather than a hole between two words.
  const mark = <DeviceMark slate={slate} offline={offline} onCopy={onCopy} onKeep={onKeep} />;

  return (
    <>
      {!markLast && mark}
      {slate.is_locked && slate.unlockedHere ? (
        // The open lock shuts on a click
        <button
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); forgetDocKey(slate.slate_number); }}
          className={`${status.cls} hover:text-[var(--theme-text)] transition-colors`}
        >
          {status.label}
        </button>
      ) : (
        <span className={status.cls}>{status.label}</span>
      )}
      {Boolean(slate.adoption_pending) && (
        <span className="text-[var(--theme-text-muted)] animate-pulse" title={strings.slates.status.syncingTitle}>
          {strings.slates.status.syncing}
        </span>
      )}
      {Boolean(slate.is_collab) && (
        <span className="text-violet-400">{strings.collab.badge}</span>
      )}
      {slate.source_app_name && (
        <span
          className="text-[var(--theme-green)]"
          title={strings.slates.status.fromAppTitle.replace('{app}', slate.source_app_name)}
        >
          {strings.slates.status.fromApp.replace('{app}', slate.source_app_name)}
        </span>
      )}
      {markLast && mark}
    </>
  );
}

/**
 * A slate's tags, as quiet words after its title. Each one filters the list.
 */
function TagWords({ slate, onTagFilter, maxTags = 3 }) {
  const tags = Array.isArray(slate.tags) ? slate.tags : [];
  if (!tags.length) return null;
  const visible = tags.slice(0, maxTags);
  const remaining = tags.length - visible.length;
  return (
    <span className="flex items-center gap-2 text-xs min-w-0 shrink">
      {visible.map(tag => (
        <button
          key={tag}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onTagFilter(tag); }}
          className="text-[var(--theme-text-dim)] hover:text-[var(--theme-text)] transition-colors max-w-[8rem] truncate"
          title={tag}
        >
          #{tag}
        </button>
      ))}
      {remaining > 0 && <span className="text-[var(--theme-text-dim)]">+{remaining}</span>}
    </span>
  );
}

const menuItemCls = (danger) =>
  `w-full px-4 py-2 text-left hover:bg-[var(--theme-bg-tertiary)] transition-colors text-xs md:text-sm flex items-center gap-2.5 ${
    danger ? 'text-[var(--theme-red)]' : 'hover:text-[var(--theme-text)]'
  } whitespace-nowrap`;

// The icon before a menu word: a shade quieter than the word itself
const menuIcon = 'w-3.5 h-3.5 shrink-0 opacity-60';

/**
 * The three-dot menu both layouts share. Own slates get pin/tags/publish/
 * delete; slates shared with me get the two-step leave.
 */
function SlateMenu({ slate, isOpen, onToggle, onPin, onTags, onPublish, onLock, onArchive, onDelete, onRestore, onDeleteForever, onLeave, leaveArmed, onOffload, onCopyToDevice }) {
  const isPinned = Boolean(slate.pinned_at);
  // Near the bottom of the window the menu opens upward instead of running
  // off the page. Measured before paint, so it never shows in the wrong place.
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const [openUp, setOpenUp] = useState(false);
  useLayoutEffect(() => {
    if (!isOpen || !wrapRef.current || !menuRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const h = menuRef.current.offsetHeight + 8;
    setOpenUp(window.innerHeight - r.bottom < h && r.top > h);
  }, [isOpen]);
  return (
    <div ref={wrapRef} className="relative flex items-center flex-shrink-0">
      <button
        onClick={onToggle}
        className="p-1 rounded hover:bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-dim)] hover:text-[var(--theme-text)] transition-colors"
        title={strings.slates.menu.more}
      >
        {/* Three dots that run together into one line while the menu is open,
            the way the writer's do. Merging is a motion: the dots travel in
            and the line grows from the middle. Splitting is not: the line
            fades where it is and the dots fade back in at their own places
            (the line's geometry snaps only after its fade is done). */}
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
          {[2, 8, 14].map((cy) => (
            <circle
              key={cy}
              cx="8"
              r="1.5"
              style={isOpen
                ? { cy: 8, opacity: 0, transition: 'cy 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 160ms ease-out 60ms' }
                : { cy, opacity: 1, transition: 'opacity 180ms ease-out' }}
            />
          ))}
          <rect
            x="7.25"
            rx="0.75"
            width="1.5"
            style={isOpen
              ? { y: 2, height: 12, opacity: 1, transition: 'y 220ms cubic-bezier(0.4, 0, 0.2, 1), height 220ms cubic-bezier(0.4, 0, 0.2, 1)' }
              : { y: 8, height: 0, opacity: 0, transition: 'opacity 180ms ease-out, y 0s linear 180ms, height 0s linear 180ms' }}
          />
        </svg>
      </button>

      {isOpen && (
        <div ref={menuRef} className={`absolute right-0 ${openUp ? 'bottom-full mb-1 origin-bottom-right animate-[menuInUp_0.15s_ease-out]' : 'top-full mt-1 origin-top-right animate-[menuInDown_0.15s_ease-out]'} bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded shadow-2xl overflow-hidden min-w-[200px] flex flex-col z-10`}>
          {slate.deleted_at ? (
            <>
              <button onClick={onRestore} className={menuItemCls(false)}>
                <UnarchiveIcon className={menuIcon} />
                {strings.slates.menu.restore}
              </button>
              <button onClick={onDeleteForever} className={menuItemCls(true)}>
                <TrashIcon className={menuIcon} />
                {strings.slates.menu.deleteForever}
              </button>
            </>
          ) : slate.shared ? (
            <button onClick={onLeave} className={menuItemCls(true)}>
              <LeaveIcon className={menuIcon} />
              {leaveArmed ? strings.collab.shared.leaveConfirm : strings.collab.shared.leave}
            </button>
          ) : (
            <>
              <button onClick={onPin} className={menuItemCls(false)}>
                {isPinned ? <UnpinIcon className={menuIcon} /> : <PinIcon className={menuIcon} />}
                {isPinned ? strings.slates.pin.unpin : strings.slates.pin.pin}
              </button>
              <button onClick={onTags} className={menuItemCls(false)}>
                <TagIcon className={menuIcon} />
                {strings.slates.menu.tags}
              </button>
              {/* This device's copy: let it go, or get it. Keeping it past
                  the budget is the check mark's job. A copy with an edit
                  still on its way stays put. */}
              {!slate.local && !slate.pending && (
                <button onClick={slate.available ? onOffload : onCopyToDevice} className={menuItemCls(false)}>
                  {slate.available ? <CloudOffIcon className={menuIcon} /> : <CloudDownIcon className={menuIcon} />}
                  {slate.available ? strings.slates.offline.offload : strings.slates.offline.copy}
                </button>
              )}
              {!slate.is_locked && (
                <button onClick={onPublish} className={menuItemCls(false)}>
                  {slate.is_published ? <EyeOffIcon className={menuIcon} /> : <GlobeIcon className={menuIcon} />}
                  {slate.is_published ? strings.slates.menu.makePrivate : strings.slates.menu.makePublic}
                </button>
              )}
              {/* A private, non-collab slate can lock; a locked one unlocks */}
              {onLock && !slate.is_published && !slate.is_collab && !slate.local && (
                <button onClick={onLock} className={menuItemCls(false)}>
                  {slate.is_locked ? <UnlockIcon className={menuIcon} /> : <LockIcon className={menuIcon} />}
                  {slate.is_locked ? strings.slates.menu.unlock : strings.slates.menu.lock}
                </button>
              )}
              {!slate.local && (
                <button onClick={onArchive} className={menuItemCls(false)}>
                  {slate.archived_at ? <UnarchiveIcon className={menuIcon} /> : <ArchiveIcon className={menuIcon} />}
                  {slate.archived_at ? strings.slates.menu.unarchive : strings.slates.menu.archive}
                </button>
              )}
              <button onClick={onDelete} className={menuItemCls(true)}>
                <TrashIcon className={menuIcon} />
                {strings.slates.menu.delete}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The device mark: where this slate stands between this device and the
 * account. A check means a copy is here (dim when the app made it, green
 * when you asked for it to stay, and a green pop the moment a sync lands);
 * clicking it switches between the two. An orange ! means it is saved here
 * but not in the account yet; while that upload runs the ring spins. A cloud
 * means it is not here yet; clicking it copies the slate and keeps it. The
 * mark is the one place for the device's copy; the menu only offloads or
 * copies. The icons are the ones people already read this way in Drive,
 * Spotify and iCloud.
 */
const DeviceMark = ({ slate, offline, onCopy, onKeep }) => {
  if (slate.shared) return null;
  const o = strings.slates.offline;
  const icon = 'w-[1em] h-[1em]';
  if (slate.syncing) {
    return (
      <HoverNote plain note={o.syncing} className="device-mark is-live p-1 -m-1 text-[var(--theme-orange)]">
        <MarkGlyph kind="spin" className={`${icon} mark-spin`} aria-label={o.syncing} role="img" />
      </HoverNote>
    );
  }
  if (slate.pending) {
    return (
      <HoverNote plain note={slate.local ? o.pending : o.pendingEdits} className="device-mark is-live p-1 -m-1 text-[var(--theme-orange)]">
        <MarkGlyph kind="alert" className={icon} aria-label={slate.local ? o.pending : o.pendingEdits} role="img" />
      </HoverNote>
    );
  }
  if (slate.available) {
    const green = slate.kept || slate.justSynced;
    const note = slate.justSynced ? o.synced : slate.kept ? o.kept : o.auto;
    return (
      <HoverNote plain note={note} className={`device-mark p-1 -m-1 ${slate.justSynced ? 'is-live' : ''} ${green ? 'text-[var(--theme-green)]' : 'text-[var(--theme-text-dim)]'}`}>
        {/* The dimming sits on the icon, not the wrapper: the hover card is a
            child of the wrapper and must stay opaque */}
        <button type="button" onClick={onKeep} aria-label={slate.kept ? o.kept : o.auto} aria-pressed={Boolean(slate.kept)} className="flex items-center">
          <MarkGlyph kind="check" className={`${icon} ${green ? '' : 'opacity-70'} ${slate.justSynced ? 'mark-pop' : ''}`} aria-hidden="true" />
        </button>
      </HoverNote>
    );
  }
  const copying = Boolean(slate.copying);
  const canCopy = !offline && !copying;
  const note = copying ? o.copying : offline ? o.missingOffline : slate.offloaded ? o.offloaded : o.missing;
  return (
    <HoverNote plain note={note} className={`device-mark p-1 -m-1 text-[var(--theme-text-dim)] ${copying ? 'animate-pulse is-live' : ''}`}>
      <button
        type="button"
        onClick={canCopy ? onCopy : undefined}
        disabled={!canCopy}
        aria-label={note}
        className="flex items-center"
      >
        <MarkGlyph kind="cloud" className={icon} aria-hidden="true" />
      </button>
    </HoverNote>
  );
};

const PinGlyph = () => (
  <svg className="w-3.5 h-3.5 text-[var(--theme-text-dim)] flex-shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M10 1.5c0-.3-.2-.5-.5-.5h-3c-.3 0-.5.2-.5.5V6L4 8v1h3v5l1-1 1 1V9h3V8l-2-2V1.5z" />
  </svg>
);

/**
 * One slate, in either clothing. `row` is the ledger line the list is made of:
 * title on the left, a quiet right-aligned meta column, hairline dividers
 * between rows. `card` keeps the bordered box for the grid. Both are thin
 * layouts over the same title/badges/menu pieces.
 */
function SlateItem({ slate, layout, onOpen, onTagFilter, menuProps, offline = false, onCopy, onKeep, hit = null, editing = false }) {
  const isPinned = Boolean(slate.pinned_at);
  // The slate the writer has open (the one the writer button goes back to)
  // rests in its hover state: no word, just the row already lit
  // Content search: the line the query was found on, the match lit up
  const snippet = hit && (
    <p className="mt-1 text-xs text-[var(--theme-text-dim)] truncate animate-[fadeIn_0.3s_ease-out]">
      {hit.before}<span className="text-[var(--theme-text)]">{hit.hit}</span>{hit.after}
      {hit.count > 1 && <span className="ml-2 opacity-60">{strings.slates.search.hits(hit.count)}</span>}
    </p>
  );
  const unavailable = offline && !slate.available && !slate.local && !slate.shared;
  const open = unavailable ? undefined : onOpen;
  const unavailableCls = unavailable ? ' slate-unavailable' : '';
  const title = slate.title || strings.slates.untitled;
  const stats = (
    <>
      <span>{strings.slates.stats.wordsShort(slate.word_count)}</span>
      <span>{strings.slates.stats.charsShort(slate.char_count)}</span>
    </>
  );

  if (layout === 'card') {
    return (
      <div
        onClick={open}
        className={`slate-item ${editing ? 'bg-[var(--theme-bg-tertiary)] border-[var(--theme-text-dim)]' : 'bg-[var(--theme-bg-secondary)] border-[var(--theme-border)]'} border p-4 rounded-lg hover:border-[var(--theme-text-dim)] hover:bg-[var(--theme-bg-tertiary)] transition-all cursor-pointer flex flex-col min-h-[132px]${unavailableCls}`}
      >
        {/* The title is the card: let it wrap to two lines instead of
            truncating at twenty characters, and gather every piece of meta
            at the bottom edge so the box has a top and a floor rather than
            three stray lines. */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            {isPinned && <span className="flex-shrink-0 mt-1"><PinGlyph /></span>}
            <h3 className="text-[var(--theme-text)] text-sm md:text-base font-medium line-clamp-2 break-words">{title}</h3>
            <span className="mt-1"><TagWords slate={slate} onTagFilter={onTagFilter} /></span>
          </div>
          <SlateMenu slate={slate} {...menuProps} />
        </div>
        {snippet}

        <div className="mt-auto pt-4 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <SlateBadges slate={slate} offline={offline} onCopy={onCopy} onKeep={onKeep} markLast />
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--theme-text-dim)]">
            <div className="flex items-center gap-3">{stats}</div>
            <span>{formatDateShort(slate.updated_at)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={open}
      className={`slate-item flex items-start md:items-center gap-3 px-2 py-3.5 ${editing ? 'bg-[var(--theme-bg-secondary)]' : ''} hover:bg-[var(--theme-bg-secondary)] cursor-pointer transition-colors${unavailableCls}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {isPinned && <PinGlyph />}
          <h3 className="text-[var(--theme-text)] text-sm md:text-base font-medium truncate min-w-0">{title}</h3>
          <TagWords slate={slate} onTagFilter={onTagFilter} />
        </div>
        {snippet}
        {/* On a phone the meta wraps under the title; on desktop it sits as a
            right-aligned column so dates line up down the page. */}
        <div className="mt-1.5 flex md:hidden flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--theme-text-dim)]">
          <SlateBadges slate={slate} offline={offline} onCopy={onCopy} onKeep={onKeep} />
          {stats}
          <span>{formatDateShort(slate.updated_at)}</span>
        </div>
      </div>

      <div className="hidden md:flex items-center gap-3 text-xs text-[var(--theme-text-dim)] flex-shrink-0">
        <SlateBadges slate={slate} offline={offline} onCopy={onCopy} onKeep={onKeep} />
        {stats}
        <span className="w-14 text-right">{formatDateShort(slate.updated_at)}</span>
      </div>

      <SlateMenu slate={slate} {...menuProps} />
    </div>
  );
}

export function SlateManager({ token, userId, onSelectSlate, onNewSlate, onOpenShared, currentSlateNumber = null }) {
  const { online } = useConnectivity();
  // Which slates this device holds a copy of, and which are pinned to it
  const [deviceCopies, setDeviceCopies] = useState({ available: new Set(), kept: new Set(), offloaded: new Set(), pending: new Set() });
  const [copying, setCopying] = useState(() => new Set());
  const refreshDeviceCopies = async () => {
    if (!userId) return;
    try {
      const [rows, queued] = await Promise.all([getCachedSlates(userId), getPending(userId)]);
      setDeviceCopies({
        available: new Set(rows.filter(r => r.data?.encryptedContent).map(r => r.slateNumber)),
        kept: new Set(rows.filter(r => r.keep).map(r => r.slateNumber)),
        offloaded: new Set(rows.filter(r => r.offloaded && !r.data?.encryptedContent).map(r => r.slateNumber)),
        pending: new Set(queued.map(q => q.slateNumber)),
      });
    } catch { /* no local store: nothing is available offline */ }
  };
  // Writes on their way to the account right now, and ones that just landed
  // (the check pops green for a moment)
  const [syncing, setSyncing] = useState(() => new Set());
  const [justSynced, setJustSynced] = useState(() => new Set());
  const popTimersRef = useRef(new Map());
  const markSynced = (n) => {
    setJustSynced(prev => new Set([...prev, n]));
    clearTimeout(popTimersRef.current.get(n));
    popTimersRef.current.set(n, setTimeout(() => setJustSynced(prev => { const s = new Set(prev); s.delete(n); return s; }), 1600));
  };
  useEffect(() => () => { for (const t of popTimersRef.current.values()) clearTimeout(t); }, []);
  const [slates, setSlates] = useState([]);
  const [loading, setLoading] = useState(true);
  // E2EE collaboration: invites waiting on me + slates others shared with me
  const [collabInvites, setCollabInvites] = useState([]);
  const [sharedSlates, setSharedSlates] = useState([]);
  const [collabBusyId, setCollabBusyId] = useState(null);
  const [leaveConfirmId, setLeaveConfirmId] = useState(null);
  const leaveTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(leaveTimerRef.current), []);
  const [showToast, toastNode] = useToast();
  const [openMenuId, setOpenMenuId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Whether the account's lock is open right now: the open locked slate
  // reads "unlocked" only while it is
  // Lock changes re-render the list: the slates whose lock is open read
  // "unlocked" while it is
  const [, setLockTick] = useState(0);
  useEffect(() => onLockChange(() => setLockTick(t => t + 1)), []);
  // The panel asked for before a lock change from the list:
  // { mode: 'setup' | 'gate', slate, info, recoveryKey, needsLogin }
  const [lockAsk, setLockAsk] = useState(null);

  // The slate as the server holds it, or the device copy when offline
  const fetchSlateForLock = async (slate) => {
    try {
      const res = await fetch(`${API_URL}/slates/${slate.slate_number}`, { credentials: 'include' });
      if (!res.ok) throw new Error('load failed');
      return await res.json();
    } catch (err) {
      const cached = isOnline() ? null : await getCachedSlate(userId, slate.slate_number).catch(() => null);
      if (cached?.data?.encryptedContent) return { ...slate, ...cached.data };
      throw err;
    }
  };
  const noteLockChange = (slateNumber, lockFields, updatedAt) => {
    setSlates(prev => prev.map(s => s.slate_number === slateNumber ? { ...s, ...lockFields, updated_at: updatedAt ?? s.updated_at } : s));
  };
  // Lock a slate from its menu: fetch it, decrypt under the master key, save
  // it re-keyed to the chosen secret
  const lockFromList = async (slate, { secret, login }, ask) => {
    const master = await getSlateKey(userId);
    if (!master) throw new Error('no key');
    let recoveryKey = ask.recoveryKey;
    if (login) recoveryKey = await ensureLockRecovery({ login, info: ask.info });
    const d = await fetchSlateForLock(slate);
    if (d.is_locked) return;
    const content = d.encryptedContent ? await decryptContent(d.encryptedContent, master) : (d.content || '');
    const { lockFields, data } = await saveLockChange({ userId, slateNumber: slate.slate_number, content, masterKey: master, lockOn: true, secret, recoveryKey, baseUpdatedAt: d.updated_at });
    noteLockChange(slate.slate_number, lockFields, data.updated_at);
  };
  // Remove a slate's lock: its doc key must be open (the secret, or recovery)
  const removeLockFromList = async (slate, docKey) => {
    const master = await getSlateKey(userId);
    if (!master) throw new Error('no key');
    const d = await fetchSlateForLock(slate);
    const content = d.encryptedContent ? await decryptContent(d.encryptedContent, docKey) : '';
    const { lockFields, data } = await saveLockChange({ userId, slateNumber: slate.slate_number, content, masterKey: master, lockOn: false, baseUpdatedAt: d.updated_at });
    noteLockChange(slate.slate_number, lockFields, data.updated_at);
  };
  const toggleLock = async (slate, e) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenMenuId(null);
    try {
      if (!slate.is_locked) {
        const info = await fetchLockRecovery(userId);
        const recoveryKey = currentRecoveryKey(info);
        const needsLogin = !recoveryKey || !loginKindsOf(recoveryKey).length;
        if (needsLogin && !isOnline()) { showToast(strings.writer.lock.needsNetwork); return; }
        setLockAsk({ mode: 'setup', slate, info, recoveryKey, needsLogin });
        return;
      }
      const open = openDocKey(slate.slate_number);
      if (open) { await removeLockFromList(slate, open); return; }
      const d = await fetchSlateForLock(slate);
      setLockAsk({ mode: 'gate', slate: { ...slate, ...d } });
    } catch (err) {
      console.error('lock change failed:', err);
      showToast(strings.writer.lock.failed);
    }
  };
  const handleLockAskSubmit = async (entry) => {
    const ask = lockAsk;
    if (ask.mode === 'setup') {
      await lockFromList(ask.slate, entry, ask);
    } else {
      const docKey = await unlockSlate(ask.slate.slate_number, entry.secret, ask.slate);
      await removeLockFromList(ask.slate, docKey);
    }
    setLockAsk(null);
  };
  const handleLockAskForgot = async () => {
    const ask = lockAsk;
    try {
      const info = await fetchLockRecovery(userId);
      setLockAsk({ ...ask, mode: 'recover', ways: recoveryWaysFor(ask.slate, info), info });
    } catch { showToast(strings.writer.lock.failed); }
  };
  const handleLockAskRecover = async ({ via }) => {
    const ask = lockAsk;
    const docKey = await recoverSlate(ask.slate.slate_number, via, ask.slate, ask.info);
    await removeLockFromList(ask.slate, docKey);
    setLockAsk(null);
    showToast(strings.writer.lock.recovered);
  };
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent'); // 'recent' | 'oldest' | 'a-z' | 'z-a' | 'words'
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('justtype-slate-view') || 'list'); // 'list' | 'grid'
  // Phones always get the list, whatever preference the desktop toggle saved.
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => setIsNarrow(!mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const effectiveViewMode = isNarrow ? 'list' : viewMode;
  const [tagFilter, setTagFilter] = useState(null);
  // Every tag across the library, most used first
  const allTags = useMemo(() => {
    const counts = new Map();
    for (const s of [...slates, ...sharedSlates]) { if (s.deleted_at) continue; for (const t of (Array.isArray(s.tags) ? s.tags : [])) counts.set(t, (counts.get(t) || 0) + 1); }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }, [slates, sharedSlates]);
  const [appFilter, setAppFilter] = useState(null); // source_app client_id, or null for all
  const [visibilityFilter, setVisibilityFilter] = useState('all'); // 'all' | 'public' | 'private' | 'archived'
  const [collabFilter, setCollabFilter] = useState(false); // true = only collaborative slates
  const [tagsModal, setTagsModal] = useState({ show: false, slateId: null, slateTitle: '', tags: [] });
  const [tagInput, setTagInput] = useState('');
  const [tagError, setTagError] = useState('');
  const [tagsSaving, setTagsSaving] = useState(false);

  // Persist view mode to localStorage
  useEffect(() => {
    localStorage.setItem('justtype-slate-view', viewMode);
  }, [viewMode]);

  // Debounce search so we don't re-filter on every keystroke for large slate lists.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchQuery(searchQuery), 150);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    if (token) {
      loadSlates();
      loadCollab();
    }
  }, [token]);

  // Best-effort: collab rows are additive UI; failures never block the list.
  const loadCollab = async () => {
    try {
      const [invites, shared] = await Promise.all([
        fetchInvites(userId),
        fetchSharedSlates(userId)
      ]);
      setCollabInvites(invites);
      setSharedSlates(shared);
    } catch (e) {
      console.warn('collab load failed', e);
    }
  };

  const handleAcceptInvite = async (invite) => {
    setCollabBusyId(invite.id);
    try {
      await acceptInvite(invite, userId);
      await loadCollab();
    } catch (e) {
      console.warn('accept invite failed', e);
    } finally {
      setCollabBusyId(null);
    }
  };

  const handleDeclineInvite = async (invite) => {
    setCollabBusyId(invite.id);
    try {
      await declineInvite(invite.id);
      setCollabInvites(prev => prev.filter(i => i.id !== invite.id));
    } catch (e) {
      console.warn('decline invite failed', e);
    } finally {
      setCollabBusyId(null);
    }
  };

  const handleLeaveShared = async (slateId) => {
    setCollabBusyId(`leave-${slateId}`);
    try {
      await leaveSharedSlate(slateId);
      setSharedSlates(prev => prev.filter(s => s.slateId !== slateId));
    } catch (e) {
      console.warn('leave shared failed', e);
    } finally {
      setCollabBusyId(null);
      setLeaveConfirmId(null);
    }
  };

  // Two-step leave from the row menu: first press arms "sure?", a second
  // press within 3s actually leaves.
  const handleLeaveClick = (slate, e) => {
    e.stopPropagation();
    clearTimeout(leaveTimerRef.current);
    if (leaveConfirmId === slate.sharedSlateId) {
      setOpenMenuId(null);
      handleLeaveShared(slate.sharedSlateId);
    } else {
      setLeaveConfirmId(slate.sharedSlateId);
      leaveTimerRef.current = setTimeout(() => setLeaveConfirmId(null), 3000);
    }
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (openMenuId !== null) {
        setOpenMenuId(null);
      }
    };

    if (openMenuId !== null) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openMenuId]);

  const loadSlates = async () => {
    setLoading(true);
    try {
      // Network first; the last list this device saw when the network fails
      let data;
      let fromCache = false;
      let trashRows = [];
      try {
        if (!isOnline()) throw new Error('offline');
        const response = await fetch(`${API_URL}/slates`, {
          credentials: 'include'
        });
        data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || strings.errors.loadFailed);
        }
        if (userId) cacheList(userId, data).catch(() => {});
        // What sits in the trash, shown under its own filter
        try {
          const tr = await fetch(`${API_URL}/slates?trash=1`, { credentials: 'include' });
          trashRows = tr.ok ? await tr.json() : [];
        } catch { trashRows = []; }
      } catch (netErr) {
        reportNetworkFailure();
        const cached = userId ? await getCachedList(userId).catch(() => null) : null;
        if (!cached) throw netErr;
        data = cached.rows;
        fromCache = true;
      }

      // Slates created offline that have no number yet
      const copies = userId ? await getCachedSlates(userId).catch(() => []) : [];
      const locals = copies.filter(c => isLocalSlateNumber(c.slateNumber)).map(c => ({
        slate_number: c.slateNumber, local: true, is_published: 0, published_at: null,
        encrypted_title: c.data.encrypted_title, word_count: c.data.word_count || 0, char_count: c.data.char_count || 0,
        created_at: new Date(c.cachedAt).toISOString(), updated_at: new Date(c.cachedAt).toISOString(), tags: [],
      }));
      data = [...locals, ...data];
      refreshDeviceCopies();
      data = [...data, ...trashRows];

      // Get slate key for decryption
      const slateKey = userId ? await getSlateKey(userId) : null;

      if (slateKey) {
        // Decrypt encrypted titles (private) and tags (E2E-only). Collab
        // slates are keyed under their shared doc key, unwrapped per slate.
        data = await Promise.all(data.map(async (slate) => {
          let title = slate.title;

          let contentKey = slateKey;
          if (slate.is_collab && slate.collab_wrapped_key) {
            try {
              contentKey = await unwrapKey(slate.collab_wrapped_key, slateKey);
            } catch (err) {
              console.error('Failed to unwrap doc key for slate:', slate.id, err);
            }
          }

          if (slate.encrypted_title && !slate.is_published) {
            try {
              const decryptedTitle = await decryptTitle(slate.encrypted_title, contentKey);
              title = decryptedTitle;
            } catch (err) {
              console.error('Failed to decrypt title for slate:', slate.id, err);
              title = strings.slates.lockedTitle;
            }
          }

          let tags = [];
          if (slate.encrypted_tags) {
            try {
              tags = await decryptTags(slate.encrypted_tags, contentKey);
            } catch (err) {
              // Tags set before sharing was turned on are still under the
              // master key — fall back so the owner never loses them.
              try {
                tags = await decryptTags(slate.encrypted_tags, slateKey);
              } catch {
                console.error('Failed to decrypt tags for slate:', slate.id, err);
                tags = [];
              }
            }
          }

          const normalizedTitle = (typeof title === 'string' && title.trim()) ? title : strings.slates.untitled;
          return { ...slate, title: normalizedTitle, tags };
        }));

        // Migration: encrypt plaintext titles for unpublished slates without encrypted_title
        const needsMigration = fromCache ? [] : data.filter(s => !s.is_published && !s.encrypted_title && s.title);
        if (needsMigration.length > 0) {
          for (const slate of needsMigration) {
            try {
              const encryptedTitleBlob = await encryptTitle(slate.title, slateKey);
              await fetch(`${API_URL}/slates/${slate.slate_number}/migrate-title`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ encryptedTitle: encryptedTitleBlob })
              });
            } catch (err) {
              console.error('Failed to migrate title for slate:', slate.id, err);
            }
          }
        }
      } else {
        // Locked state: we can't decrypt private E2E titles/tags yet. Keep UI stable.
        data = data.map(slate => ({
          ...slate,
          title: (typeof slate.title === 'string' && slate.title.trim())
            ? slate.title
            : (slate.encrypted_title ? strings.slates.lockedTitle : strings.slates.untitled),
          tags: [],
        }));
      }

      setSlates(data);

      // Every slate gets a copy on this device, newest first within the
      // budget, and copies that fell behind the server are refreshed. The
      // marks fill in as each one lands.
      if (!fromCache && userId) {
        dropStaleCopies(userId, data.filter(r => !r.local).map(r => r.slate_number)).catch(() => {});
        copyToDevice(copyPlan(data, copies));
      }
    } catch (err) {
      console.error('Failed to load slates:', err);
    } finally {
      setLoading(false);
    }
  };

  // Pin or unpin a slate to this device; pinning fetches it right away
  // Fetch these slates into the device store, two at a time and paced under
  // the api rate limit, refreshing the marks as each lands. A refusal stops
  // the run; whatever is left waits for the next list load.
  const copyToDevice = async (numbers) => {
    if (!userId || !numbers.length || !isOnline()) return;
    setCopying(prev => new Set([...prev, ...numbers]));
    const queue = [...numbers];
    const done = (n) => setCopying(prev => { const s = new Set(prev); s.delete(n); return s; });
    const worker = async () => {
      for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
        const started = Date.now();
        try {
          const r = await fetch(`${API_URL}/slates/${n}`, { credentials: 'include' });
          if (r.status === 429) { queue.length = 0; }
          else if (r.ok) await cacheSlate(userId, n, await r.json());
        } catch { /* next list load retries */ }
        done(n);
        refreshDeviceCopies();
        const wait = 250 - (Date.now() - started);
        if (wait > 0 && queue.length) await new Promise(res => setTimeout(res, wait));
      }
    };
    await Promise.all([worker(), worker()]);
    setCopying(prev => { const s = new Set(prev); numbers.forEach(n => s.delete(n)); return s; });
    pruneCache(userId).catch(() => {});
  };

  const setSlateKept = async (slate, next) => {
    if (!userId) return;
    try {
      await setKeepOffline(userId, slate.slate_number, next);
    } catch (err) {
      console.error('keep on device failed:', err);
    }
    refreshDeviceCopies();
    if (next && !deviceCopies.available.has(slate.slate_number)) await copyToDevice([slate.slate_number]);
  };

  // The check mark: dim (the app's copy) to green (kept past the budget) and back
  const toggleKeepOffline = (slate, e) => {
    e.stopPropagation();
    e.preventDefault();
    // A mouse click leaves focus on the button, and the row shows its mark
    // while anything inside has focus; drop it so the mark hides on mouse-out
    // (a keyboard toggle, detail 0, keeps its focus)
    if (e.detail > 0) e.currentTarget.blur();
    setSlateKept(slate, !deviceCopies.kept.has(slate.slate_number));
  };

  // The cloud mark, or the menu: copy it now and keep it, budget or not
  const copySlateNow = (slate, e) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenMenuId(null);
    setSlateKept(slate, true);
  };

  // Free the space: the copy goes, and stays gone until asked for
  const offloadFromDevice = async (slate, e) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenMenuId(null);
    if (!userId) return;
    try {
      await offloadSlate(userId, slate.slate_number);
    } catch (err) {
      console.error('offload failed:', err);
    }
    refreshDeviceCopies();
  };

  // A local slate got its number, or a queued edit landed: refresh
  useEffect(() => onSync((ev) => {
    const drop = (n) => setSyncing(prev => { const s = new Set(prev); s.delete(n); return s; });
    if (ev.type === 'started') setSyncing(new Set(ev.slates || []));
    else if (ev.type === 'synced') { drop(ev.from); markSynced(ev.to); loadSlates(); }
    else if (ev.type === 'flushed') { drop(ev.slateNumber); markSynced(ev.slateNumber); refreshDeviceCopies(); }
    else if (ev.type === 'failed') drop(ev.slateNumber);
    else if (ev.type === 'finished') { setSyncing(new Set()); refreshDeviceCopies(); }
  }), [userId]);

  // Delete: to the trash, with a word to bring it straight back. Restore
  // and delete forever act on what is in the trash; empty trash clears it.
  const markDeleted = (n, deletedAt) => setSlates(prev => prev.map(s => (s.slate_number === n ? { ...s, deleted_at: deletedAt } : s)));
  const restoreSlate = async (slate, e) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    setOpenMenuId(null);
    try {
      const r = await fetch(`${API_URL}/slates/${slate.slate_number}/restore`, { method: 'POST', credentials: 'include' });
      if (!r.ok) throw new Error('restore failed');
      markDeleted(slate.slate_number, null);
      showToast(strings.slates.trash.restored);
    } catch (err) {
      console.error('Failed to restore slate:', err);
      showToast(strings.errors.deleteSlate);
    }
  };
  const trashSlate = async (slate, e) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenMenuId(null);
    try {
      const r = await fetch(`${API_URL}/slates/${slate.slate_number}`, { method: 'DELETE', credentials: 'include' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(data.error || strings.errors.deleteSlate); return; }
      markDeleted(slate.slate_number, data.deleted_at || Math.floor(Date.now() / 1000));
      showToast(strings.slates.trash.moved, { action: { label: strings.slates.trash.undo, onClick: () => restoreSlate(slate) } });
    } catch (err) {
      console.error('Failed to delete slate:', err);
      showToast(strings.errors.deleteSlate);
    }
  };
  const deleteForever = async (slate, e) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenMenuId(null);
    try {
      const r = await fetch(`${API_URL}/slates/${slate.slate_number}?forever=1`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) { const data = await r.json().catch(() => ({})); showToast(data.error || strings.errors.deleteSlate); return; }
      setSlates(prev => prev.filter(s => s.slate_number !== slate.slate_number));
      showToast(strings.slates.trash.gone);
    } catch (err) {
      console.error('Failed to delete slate:', err);
      showToast(strings.errors.deleteSlate);
    }
  };
  const emptyTrash = async () => {
    try {
      const r = await fetch(`${API_URL}/slates/trash`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) throw new Error('empty failed');
      setSlates(prev => prev.filter(s => !s.deleted_at));
      showToast(strings.slates.trash.emptied);
    } catch (err) {
      console.error('Failed to empty the trash:', err);
      showToast(strings.errors.deleteSlate);
    }
  };

  // Archive: the slate leaves the list for the archived section, and comes
  // back the same way. Nothing else about it changes.
  const toggleArchive = async (slate, e) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenMenuId(null);
    const archived = !slate.archived_at;
    try {
      const response = await fetch(`${API_URL}/slates/${slate.slate_number}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ archived }),
      });
      const data = await response.json();
      if (!response.ok) { showToast(data.error || strings.errors.archiveFailed); return; }
      setSlates(prev => prev.map(s => s.slate_number === slate.slate_number ? { ...s, archived_at: data.archived_at } : s));
    } catch (err) {
      console.error('Failed to toggle archive:', err);
      showToast(strings.errors.archiveFailed);
    }
  };

  const togglePin = async (slate, e) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenMenuId(null);

    const isPinned = Boolean(slate.pinned_at);
    try {
      const response = await fetch(`${API_URL}/slates/${slate.slate_number}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pinned: !isPinned }),
      });

      const data = await response.json();

      if (response.ok) {
        setSlates(prevSlates =>
          prevSlates.map(s =>
            s.slate_number === slate.slate_number
              ? { ...s, pinned_at: data.pinned_at }
              : s
          )
        );
      } else {
        showToast(data.error || strings.errors.pinFailed);
      }
    } catch (err) {
      console.error('Failed to toggle pin:', err);
      showToast(strings.errors.pinFailed);
    }
  };

  const openTagsEditor = (slate, e) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenMenuId(null);
    setTagInput('');
    setTagError('');
    setTagsModal({
      show: true,
      slateId: slate.slate_number,
      slateTitle: slate.title || strings.slates.untitled,
      tags: Array.isArray(slate.tags) ? slate.tags : [],
    });
  };

  const closeTagsEditor = () => {
    withViewTransition(() => setTagsModal({ show: false, slateId: null, slateTitle: '', tags: [] }));
    setTagInput('');
    setTagError('');
    setTagsSaving(false);
  };

  useEscape(tagsModal.show, closeTagsEditor);

  const normalizeTag = (raw) => raw.trim().toLowerCase();

  const addTagFromInput = () => {
    const next = normalizeTag(tagInput);
    setTagError('');

    if (!next) return;
    if (!TAG_REGEX.test(next)) {
      setTagError(strings.slates.tags.invalidTag);
      return;
    }
    if (next.length > MAX_TAG_LENGTH) {
      setTagError(strings.slates.tags.tooLong(MAX_TAG_LENGTH));
      return;
    }
    if (tagsModal.tags.length >= MAX_TAGS_PER_SLATE) {
      setTagError(strings.slates.tags.tooMany(MAX_TAGS_PER_SLATE));
      return;
    }
    if (tagsModal.tags.includes(next)) {
      setTagInput('');
      return;
    }

    setTagsModal(prev => ({ ...prev, tags: [...prev.tags, next] }));
    setTagInput('');
  };

  const removeTag = (tag) => {
    setTagsModal(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
  };

  const saveTags = async () => {
    setTagError('');
    setTagsSaving(true);

    try {
      const slateKey = userId ? await getSlateKey(userId) : null;
      if (!slateKey) {
        setTagError(strings.slates.tags.unlockRequired);
        setTagsSaving(false);
        return;
      }

      const normalized = tagsModal.tags
        .map(t => normalizeTag(t))
        .filter(Boolean);

      // Collab slates: tags go under the shared doc key so members see them too.
      let tagsKey = slateKey;
      const tagSlate = slates.find(s => s.slate_number === tagsModal.slateId);
      if (tagSlate && tagSlate.is_collab && tagSlate.collab_wrapped_key) {
        try {
          tagsKey = await unwrapKey(tagSlate.collab_wrapped_key, slateKey);
        } catch (err) {
          console.error('Failed to unwrap doc key for tags:', err);
        }
      }

      const encryptedTagsBlob = normalized.length > 0
        ? await encryptTags(normalized, tagsKey)
        : null;

      const response = await fetch(`${API_URL}/slates/${tagsModal.slateId}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ encryptedTags: encryptedTagsBlob }),
      });

      const data = await response.json();

      if (!response.ok) {
        setTagError(data.error || strings.errors.tagsSaveFailed);
        setTagsSaving(false);
        return;
      }

      setSlates(prevSlates =>
        prevSlates.map(s =>
          s.slate_number === tagsModal.slateId
            ? { ...s, tags: normalized, encrypted_tags: encryptedTagsBlob }
            : s
        )
      );

      closeTagsEditor();
    } catch (err) {
      console.error('Failed to save tags:', err);
      setTagError(strings.errors.tagsSaveFailed);
      setTagsSaving(false);
    }
  };

  const togglePublish = async (slate, e) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenMenuId(null);

    try {
      const nextPublished = !slate.is_published;
      const slateKey = userId ? await getSlateKey(userId) : null;
      const looksE2E = Boolean(slate.encrypted_title) || slate.title === null;

      const body = { isPublished: nextPublished };

      if (slateKey) {
        if (nextPublished) {
          // Publishing an E2E slate requires a plaintext public copy.
          const slateResp = await fetch(`${API_URL}/slates/${slate.slate_number}`, { credentials: 'include' });
          const slateData = await slateResp.json();

          if (!slateResp.ok) {
            showToast(slateData.error || strings.errors.loadFailed);
            return;
          }

          let plaintext = slateData.content || '';
          if (slateData.encrypted && slateData.encryptedContent) {
            // Collab slates decrypt with the shared doc key, not the master key
            let contentKey = slateKey;
            if (slateData.is_collab && slateData.collab_wrapped_key) {
              contentKey = await unwrapKey(slateData.collab_wrapped_key, slateKey);
            }
            plaintext = await decryptContent(slateData.encryptedContent, contentKey);
          }

          const firstLine = plaintext.split('\n')[0].trim();
          body.publicContent = plaintext;
          body.publicTitle = firstLine || strings.slates.untitled;
        } else {
          // Unpublishing an E2E slate requires an encrypted title (ZK).
          const titleToEncrypt = (slate.title || strings.slates.untitled).trim() || strings.slates.untitled;
          body.encryptedTitle = await encryptTitle(titleToEncrypt, slateKey);
        }
      } else if (looksE2E) {
        showToast(strings.slates.unlockRequired);
        return;
      }

      const response = await fetch(`${API_URL}/slates/${slate.slate_number}/publish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const data = await response.json();
        setSlates(prevSlates =>
          prevSlates.map(s =>
            s.slate_number === slate.slate_number
              ? {
                  ...s,
                  is_published: nextPublished,
                  share_id: data.share_id,
                  // published_at is kept even after unpublishing to track "was public"
                  published_at: nextPublished ? (s.published_at || new Date().toISOString()) : s.published_at,
                  // Keep local state in sync with server title-encryption behavior
                  encrypted_title: !nextPublished && body.encryptedTitle ? body.encryptedTitle : null,
                  title: nextPublished && body.publicTitle ? body.publicTitle : s.title,
                }
              : s
          )
        );
      } else {
        const data = await response.json();
        showToast(data.error || strings.errors.publishFailed);
      }
    } catch (err) {
      console.error('Failed to toggle publish:', err);
      showToast(strings.errors.publishFailed);
    }
  };

  const toggleMenu = (id, e) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenMenuId(openMenuId === id ? null : id);
  };

  // Distinct apps that have created (dropped) slates, for the "from app" filter.
  const sourceApps = useMemo(() => {
    const map = new Map(); // client_id -> display name
    for (const s of slates) {
      if (s.source_app) map.set(s.source_app, s.source_app_name || s.source_app);
    }
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [slates]);

  // Content search. Two characters or more searches the text of every copy
  // on this device as you type; the rest can be fetched with 'search deeper'.
  const contentQuery = debouncedSearchQuery.trim().toLowerCase().length >= 2 ? debouncedSearchQuery.trim().toLowerCase() : '';
  // The text index lives in the search module for the session; this counter
  // ticks whenever it grows so the hits below are recomputed
  const [indexVersion, setIndexVersion] = useState(0);
  const [deepSearch, setDeepSearch] = useState(null); // { done, total } while fetching
  const [deepNote, setDeepNote] = useState('');
  const deepNoteTimerRef = useRef(null);
  useEffect(() => {
    if (!contentQuery || !userId) return;
    let cancelled = false;
    indexDevice(userId).then(() => { if (!cancelled) setIndexVersion(v => v + 1); });
    return () => { cancelled = true; };
  }, [contentQuery ? userId : null]);
  useEffect(() => () => clearTimeout(deepNoteTimerRef.current), []);
  const { contentHits, unsearched } = useMemo(() => {
    const hits = new Map(); // number -> snippet
    const missing = []; // numbers with no text on this device
    if (!contentQuery || !userId) return { contentHits: hits, unsearched: missing };
    for (const s of slates) {
      if (s.shared || s.local) continue;
      if (!isIndexed(userId, s.slate_number)) { missing.push(s.slate_number); continue; }
      const found = findIn(userId, s.slate_number, contentQuery);
      if (found) hits.set(s.slate_number, found);
    }
    return { contentHits: hits, unsearched: missing };
  }, [contentQuery, indexVersion, slates, userId]);
  const searchDeeper = async () => {
    if (!userId || deepSearch || !unsearched.length || !isOnline()) return;
    const total = unsearched.length;
    let done = 0;
    setDeepSearch({ done, total });
    await indexDeeper(userId, unsearched, () => {
      done++;
      setDeepSearch({ done, total });
      setIndexVersion(v => v + 1);
    });
    refreshDeviceCopies();
    setDeepSearch(null);
    setDeepNote(strings.slates.search.everything);
    clearTimeout(deepNoteTimerRef.current);
    deepNoteTimerRef.current = setTimeout(() => setDeepNote(''), 2500);
  };
  // The line under the results: it morphs between its states and fades out
  // with its last words
  // Nothing to say until the device has been indexed once: the count would
  // be every slate for a moment and then fade
  const deepLine = deepSearch ? strings.slates.search.progress(deepSearch.done, deepSearch.total)
    : deepNote || (indexVersion > 0 && unsearched.length ? strings.slates.search.notOnDevice(unsearched.length) : '');
  const lastDeepLineRef = useRef('');
  if (deepLine) lastDeepLineRef.current = deepLine;

  const filteredAndSortedSlates = useMemo(() => {
    const q = debouncedSearchQuery.trim().toLowerCase();
    const activeTag = tagFilter;

    // Slates shared with me live in the same list as my own — normalized to
    // the slate shape so sort/search/filter treat them identically.
    const sharedAsSlates = sharedSlates.map(sh => ({
      shared: true,
      sharedSlateId: sh.slateId,
      id: `shared-${sh.slateId}`,
      slate_number: `shared-${sh.slateId}`,
      title: sh.title,
      tags: sh.tags || [],
      word_count: sh.wordCount || 0,
      char_count: sh.charCount || 0,
      updated_at: sh.updatedAt,
      created_at: sh.updatedAt,
      is_published: 0,
      published_at: null,
      pinned_at: null,
      is_collab: 1,
      owner: sh.owner,
      source_app: null,
      source_app_name: null,
      adoption_pending: 0,
    }));

    const filtered = [...slates, ...sharedAsSlates].filter(slate => {
      const tags = Array.isArray(slate.tags) ? slate.tags : [];

      if (appFilter && slate.source_app !== appFilter) {
        return false;
      }

      // The trash and the archive each live in their own section
      if (visibilityFilter === 'trash') return Boolean(slate.deleted_at);
      if (slate.deleted_at) return false;
      if (visibilityFilter === 'archived') return Boolean(slate.archived_at);
      if (slate.archived_at) return false;
      if (visibilityFilter === 'public' && !slate.is_published) return false;
      if (visibilityFilter === 'private' && slate.is_published) return false;

      if (collabFilter && !slate.is_collab) {
        return false;
      }

      if (activeTag && !tags.includes(activeTag)) {
        return false;
      }

      if (!q) return true;

      const title = (slate.title || '').toString().toLowerCase();
      if (title.includes(q)) return true;

      if (tags.some(t => (t || '').toString().toLowerCase().includes(q))) return true;

      return contentHits.has(slate.slate_number);
    });

    const compareBySort = (a, b) => {
      switch (sortBy) {
        case 'oldest':
          return new Date(a.updated_at) - new Date(b.updated_at);
        case 'a-z':
          return (a.title || '').toString().localeCompare((b.title || '').toString());
        case 'z-a':
          return (b.title || '').toString().localeCompare((a.title || '').toString());
        case 'words':
          return (b.word_count || 0) - (a.word_count || 0);
        case 'recent':
        default:
          return new Date(b.updated_at) - new Date(a.updated_at);
      }
    };

    return filtered.sort((a, b) => {
      const aPinned = a.pinned_at ? 1 : 0;
      const bPinned = b.pinned_at ? 1 : 0;

      // Pinned always first; within pinned, newest pinned first.
      if (aPinned && bPinned) {
        const diff = (b.pinned_at || 0) - (a.pinned_at || 0);
        if (diff !== 0) return diff;
        return compareBySort(a, b);
      }

      if (aPinned !== bPinned) return bPinned - aPinned;

      return compareBySort(a, b);
    });
  }, [slates, sharedSlates, debouncedSearchQuery, contentHits, tagFilter, appFilter, collabFilter, visibilityFilter, sortBy]);

  // Drop the app filter if the matching app no longer has any slates (e.g. all deleted).
  useEffect(() => {
    if (appFilter && !sourceApps.some(a => a.id === appFilter)) setAppFilter(null);
  }, [appFilter, sourceApps]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--theme-text-dim)]">{strings.slates.loading}</div>
      </div>
    );
  }

  const hasAnySlates = slates.length > 0 || sharedSlates.length > 0;
  const hasCollabSlates = slates.some(s => s.is_collab) || sharedSlates.length > 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="flex justify-between items-center mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl text-[var(--theme-text)]">{strings.slates.title}</h1>
          <button
            onClick={onNewSlate}
            className="border border-[var(--theme-border)] text-[var(--theme-text)] px-4 md:px-6 py-2 rounded hover:bg-[var(--theme-accent)] hover:text-[var(--theme-bg)] hover:border-[var(--theme-accent)] transition-all duration-300 text-xs md:text-sm"
          >
            {strings.slates.newSlate}
          </button>
        </div>

        {/* Collab invites waiting on me */}
        {collabInvites.length > 0 && (
          <div className="mb-6">
            <p className="text-xs text-[var(--theme-text-dim)] mb-2">{strings.collab.invites.title}</p>
            <div className="flex flex-col gap-2">
              {collabInvites.map((invite) => (
                <div key={invite.id} className="flex items-center justify-between gap-3 p-3 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded">
                  <div className="min-w-0">
                    <span className="text-sm text-[var(--theme-text)] truncate block">{invite.title || strings.slates.untitled}</span>
                    <span className="text-xs text-[var(--theme-text-dim)]">{strings.collab.invites.from(invite.owner)}</span>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleAcceptInvite(invite)}
                      disabled={collabBusyId === invite.id || !invite.docKey}
                      className="bg-white text-black px-3 py-1.5 rounded hover:bg-[#e5e5e5] transition-all text-xs font-medium disabled:opacity-50"
                    >
                      {collabBusyId === invite.id ? strings.collab.invites.working : strings.collab.invites.accept}
                    </button>
                    <button
                      onClick={() => handleDeclineInvite(invite)}
                      disabled={collabBusyId === invite.id}
                      className="border border-[var(--theme-border)] px-3 py-1.5 rounded hover:bg-[var(--theme-bg-tertiary)] transition-all text-xs disabled:opacity-50"
                    >
                      {strings.collab.invites.decline}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search on one line, every list control on one quiet line below it */}
        {hasAnySlates && (
          <div className="flex flex-col gap-3 mb-6">
            <div className="flex gap-3 items-center">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={strings.slates.searchPlaceholder}
                className="flex-1 h-10 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded px-4 focus:outline-none focus:border-[var(--theme-text-dim)] text-[var(--theme-text)] text-sm placeholder-[var(--theme-text-dim)]"
              />

              {/* View Mode Toggle (desktop only: both layouts are one column
                  on a phone, so the control had nothing to switch) */}
              <div className="hidden md:flex items-center border border-[var(--theme-border)] rounded overflow-hidden h-10 flex-shrink-0">
                <button
                  onClick={() => withViewTransition(() => setViewMode('list'))}
                  className={`h-10 w-10 flex items-center justify-center transition-colors ${viewMode === 'list' ? 'bg-[var(--theme-bg-tertiary)] text-[var(--theme-text)]' : 'text-[var(--theme-text-dim)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg-tertiary)]'}`}
                  title={strings.slates.viewToggle.list}
                >
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                    <rect x="1" y="2" width="14" height="2" rx="0.5"/>
                    <rect x="1" y="7" width="14" height="2" rx="0.5"/>
                    <rect x="1" y="12" width="14" height="2" rx="0.5"/>
                  </svg>
                </button>
                <button
                  onClick={() => withViewTransition(() => setViewMode('grid'))}
                  className={`h-10 w-10 flex items-center justify-center transition-colors ${viewMode === 'grid' ? 'bg-[var(--theme-bg-tertiary)] text-[var(--theme-text)]' : 'text-[var(--theme-text-dim)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg-tertiary)]'}`}
                  title={strings.slates.viewToggle.grid}
                >
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                    <rect x="1" y="1" width="6" height="6" rx="1"/>
                    <rect x="9" y="1" width="6" height="6" rx="1"/>
                    <rect x="1" y="9" width="6" height="6" rx="1"/>
                    <rect x="9" y="9" width="6" height="6" rx="1"/>
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs md:text-sm">
              <ChoiceRow
                label={strings.slates.sortLabel}
                options={SORT_OPTIONS}
                value={sortBy}
                onChange={setSortBy}
              />
              <ChoiceRow
                label={strings.slates.filterVisibility}
                options={[
                  { id: 'all', label: strings.slates.filterVisibilityAll },
                  { id: 'public', label: strings.slates.filterVisibilityPublic },
                  { id: 'private', label: strings.slates.filterVisibilityPrivate },
                  { id: 'archived', label: strings.slates.filterVisibilityArchived },
                  { id: 'trash', label: strings.slates.filterVisibilityTrash },
                ]}
                value={visibilityFilter}
                onChange={setVisibilityFilter}
              />
              {visibilityFilter === 'trash' && slates.some(s => s.deleted_at) && (
                <button onClick={emptyTrash} className="text-[var(--theme-red)] hover:opacity-70 transition-opacity">
                  {strings.slates.trash.empty}
                </button>
              )}
              {hasCollabSlates && (
                <ChoiceRow
                  label={strings.collab.filter.label}
                  options={[
                    { id: 'all', label: strings.collab.filter.all },
                    { id: 'collab', label: strings.collab.filter.collab },
                  ]}
                  value={collabFilter ? 'collab' : 'all'}
                  onChange={(id) => setCollabFilter(id === 'collab')}
                />
              )}
              {sourceApps.length > 0 && (
                <ChoiceRow
                  label={strings.slates.filterByApp}
                  options={[
                    { id: ALL_APPS, label: strings.slates.filterAllApps },
                    ...sourceApps.map(app => ({ id: app.id, label: app.name, title: app.name })),
                  ]}
                  value={appFilter ?? ALL_APPS}
                  onChange={(id) => setAppFilter(id === ALL_APPS ? null : id)}
                />
              )}
            </div>
            {/* Every tag in the library, a row of its own under sort and show */}
            {allTags.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs md:text-sm">
                <ChoiceRow
                  label={strings.slates.tags.rowLabel}
                  options={[
                    { id: ALL_TAGS, label: strings.slates.tags.all },
                    ...allTags.map(tag => ({ id: tag, label: `#${tag}`, title: tag })),
                  ]}
                  value={tagFilter && allTags.includes(tagFilter) ? tagFilter : ALL_TAGS}
                  onChange={(id) => setTagFilter(id === ALL_TAGS ? null : id)}
                />
              </div>
            )}
          </div>
        )}

      {!hasAnySlates ? (
        <div className="text-center py-16">
          <p className="text-[var(--theme-text-dim)] mb-4 text-sm md:text-base">{strings.slates.empty.message}</p>
          <button
            onClick={onNewSlate}
            className="text-[var(--theme-accent)] hover:underline text-sm md:text-base"
          >
            {strings.slates.empty.cta}
          </button>
        </div>
      ) : filteredAndSortedSlates.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[var(--theme-text-dim)] text-sm md:text-base">{searchQuery.trim() ? strings.slates.noMatches(searchQuery) : (strings.slates.noneUnder[visibilityFilter] || strings.slates.noneUnder.all)}</p>
        </div>
      ) : (
        <div
          key={`${effectiveViewMode}:${sortBy}:${visibilityFilter}:${collabFilter}`}
          className={`animate-[fadeIn_0.3s_ease-out] ${
            effectiveViewMode === 'list'
              ? 'border-y border-[var(--theme-border-light)] divide-y divide-[var(--theme-border-light)]'
              : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'
          }`}
        >
          {filteredAndSortedSlates.map((slate) => (
            <SlateItem
              key={slate.slate_number}
              slate={{
                ...slate,
                kept: deviceCopies.kept.has(slate.slate_number),
                available: deviceCopies.available.has(slate.slate_number),
                offloaded: deviceCopies.offloaded.has(slate.slate_number),
                pending: slate.local || deviceCopies.pending.has(slate.slate_number),
                syncing: syncing.has(slate.slate_number),
                justSynced: justSynced.has(slate.slate_number),
                copying: copying.has(slate.slate_number),
                unlockedHere: isOpen(slate.slate_number),
              }}
              offline={!online}
              hit={contentHits.get(slate.slate_number) || null}
              editing={currentSlateNumber != null && slate.slate_number === currentSlateNumber}
              onCopy={(e) => copySlateNow(slate, e)}
              onKeep={(e) => toggleKeepOffline(slate, e)}
              layout={effectiveViewMode === 'list' ? 'row' : 'card'}
              onOpen={() => slate.shared ? (onOpenShared && onOpenShared(slate.sharedSlateId)) : onSelectSlate(slate)}
              onTagFilter={setTagFilter}
              menuProps={{
                isOpen: openMenuId === slate.slate_number,
                onToggle: (e) => toggleMenu(slate.slate_number, e),
                onPin: (e) => togglePin(slate, e),
                onTags: (e) => openTagsEditor(slate, e),
                onOffload: (e) => offloadFromDevice(slate, e),
                onCopyToDevice: (e) => copySlateNow(slate, e),
                onPublish: (e) => togglePublish(slate, e),
                onLock: (e) => toggleLock(slate, e),
                onArchive: (e) => toggleArchive(slate, e),
                onDelete: (e) => trashSlate(slate, e),
                onRestore: (e) => restoreSlate(slate, e),
                onDeleteForever: (e) => deleteForever(slate, e),
                onLeave: (e) => handleLeaveClick(slate, e),
                leaveArmed: leaveConfirmId === slate.sharedSlateId,
              }}
            />
          ))}
        </div>
      )}

      {/* Content search: what is not on this device, and the way to search it */}
      {contentQuery && (
        <div className={`py-5 text-center text-xs text-[var(--theme-text-dim)] transition-opacity duration-500 ${deepLine ? 'opacity-100' : 'opacity-0'}`}>
          <TextMorph>{lastDeepLineRef.current}</TextMorph>
          {!deepSearch && !deepNote && unsearched.length > 0 && (
            <>
              <span className="opacity-30 mx-2">·</span>
              <button
                type="button"
                onClick={searchDeeper}
                disabled={!online}
                className="hover:text-[var(--theme-text)] transition-colors disabled:cursor-default disabled:hover:text-[var(--theme-text-dim)]"
              >
                {online ? strings.slates.search.deeper : strings.slates.search.offline}
              </button>
            </>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {/* Tags Modal */}
      {tagsModal.show && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded animate-modal-content p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-[var(--theme-text)] mb-1">{strings.slates.tags.title}</h2>
            <p className="text-xs text-[var(--theme-text-dim)] mb-5 truncate">{tagsModal.slateTitle}</p>

            <div className="flex flex-wrap gap-2 mb-4 min-h-[28px]">
              {tagsModal.tags.length === 0 ? (
                <span className="text-xs text-[var(--theme-text-dim)]">{strings.slates.tags.emptyHint}</span>
              ) : (
                tagsModal.tags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => removeTag(tag)}
                    className="text-xs px-2 py-1 rounded border border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:border-[var(--theme-text-dim)] hover:bg-[var(--theme-bg-tertiary)] transition-colors"
                    title={tag}
                  >
                    {tag} <span className="text-[var(--theme-text-dim)] ml-2">x</span>
                  </button>
                ))
              )}
            </div>

            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTagFromInput();
                  }
                }}
                placeholder={strings.slates.tags.addPlaceholder}
                className="flex-1 h-10 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-3 focus:outline-none focus:border-[var(--theme-text-dim)] text-[var(--theme-text)] text-sm placeholder-[var(--theme-text-dim)]"
              />
              <button
                onClick={addTagFromInput}
                className="h-10 px-4 rounded border border-[var(--theme-border)] text-[var(--theme-text)] hover:bg-[var(--theme-bg-tertiary)] hover:border-[var(--theme-text-dim)] transition-colors text-sm"
              >
                {strings.slates.tags.addButton}
              </button>
            </div>

            {tagError && (
              <div className="text-xs text-[var(--theme-red)] mb-4">
                {tagError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={closeTagsEditor}
                disabled={tagsSaving}
                className="flex-1 border border-[var(--theme-border)] text-[var(--theme-text)] px-6 py-3 rounded hover:bg-[var(--theme-bg-tertiary)] transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {strings.slates.tags.cancel}
              </button>
              <button
                onClick={saveTags}
                disabled={tagsSaving}
                className="flex-1 bg-[var(--theme-accent)] text-[var(--theme-bg)] px-6 py-3 rounded hover:opacity-90 transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {tagsSaving ? strings.slates.tags.saving : strings.slates.tags.save}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
      {toastNode}
      {lockAsk && lockAsk.mode === 'recover' && (
        <LockRecoverModal
          ways={lockAsk.ways}
          loginKind={loginKind()}
          onVerify={(via) => verifyRecoveryWay(lockAsk.slate, via, lockAsk.info)}
          onRecover={handleLockAskRecover}
          onClose={() => setLockAsk(null)}
        />
      )}
      {lockAsk && lockAsk.mode !== 'recover' && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay z-[60] flex items-center justify-center p-4" onClick={() => setLockAsk(null)}>
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded animate-modal-content py-8 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <LockPanel
              mode={lockAsk.mode}
              needsLogin={!!lockAsk.needsLogin}
              loginKind={loginKind()}
              ways={lockAsk.recoveryKey ? waysOf(lockAsk.recoveryKey) : null}
              onVerify={lockAsk.mode === 'gate' ? undefined : verifyLogin}
              onSubmit={handleLockAskSubmit}
              onForgot={lockAsk.mode === 'gate' && lockAsk.slate.lock_recovery_wrapped_key ? handleLockAskForgot : undefined}
              onCancel={() => setLockAsk(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
