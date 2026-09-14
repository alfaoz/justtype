import React, { useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';
import { decryptContent, decryptTags, decryptTitle, encryptTags, encryptTitle, unwrapKey } from '../crypto';
import { useConnectivity, isOnline, reportNetworkFailure } from '../connectivity';
import { cacheList, getCachedList, getCachedSlates, getCachedSlate, getPending, cacheSlate, setKeepOffline, offloadSlate, isLocalSlateNumber, pruneCache, copyPlan, dropStaleCopies } from '../offlineStore';
import { onSync } from '../offlineSync';
import { HoverNote } from './HoverNote';
import { markdownOf, zipOf, fileNameFor, downloadText, downloadBlob } from '../exporter';
import { openDocKey as openLockKey } from '../slateLock';
import { createPortal } from 'react-dom';
const MarkdownViewLazy = React.lazy(() => import('./LivePreviewEditor').then(m => ({ default: m.MarkdownView })));
import { MarkGlyph } from './MarkGlyph';
import { getSlateKey } from '../keyStore';
import { fetchInvites, acceptInvite, declineInvite, fetchSharedSlates, leaveSharedSlate } from '../collab';
import { useToast } from './Toast';
import { withViewTransition } from '../viewTransition';
import { motionOff } from '../motion';
import { useEscape } from '../useEscape';
import { TextMorph } from './TextMorph';
import { ChoiceRow } from './ChoiceRow';
import { ScrollRow } from './ScrollRow';
import { goneForever, readGone, writeGone, GONE_WAYS } from '../goneLab';
import { Ico, PinIcon, UnpinIcon, TagIcon, CloudDownIcon, CloudOffIcon, GlobeIcon, EyeOffIcon, EyeIcon, LockIcon, UnlockIcon, ArchiveIcon, UnarchiveIcon, TrashIcon, LeaveIcon, ArrowUpIcon, ArrowDownIcon, ImportIcon, SelectIcon, SortIcon } from './icons';
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
 * Three dots that open a small menu: the slate rows have one, and in edit
 * mode every tag does.
 */
function DotMenu({ isOpen, onToggle, children, small = false }) {
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
        className={`${small ? 'p-0.5' : 'p-1'} rounded hover:bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-dim)] hover:text-[var(--theme-text)] transition-colors`}
        title={strings.slates.menu.more}
      >
        {/* Three dots that run together into one line while the menu is open,
            the way the writer's do. Merging is a motion: the dots travel in
            and the line grows from the middle. Splitting is not: the line
            fades where it is and the dots fade back in at their own places
            (the line's geometry snaps only after its fade is done). */}
        <svg className={small ? 'w-3 h-3' : 'w-4 h-4'} fill="currentColor" viewBox="0 0 16 16">
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
        <div ref={menuRef} data-dropdown className={`absolute right-0 ${openUp ? 'bottom-full mb-1 origin-bottom-right animate-[menuInUp_0.15s_ease-out]' : 'top-full mt-1 origin-top-right animate-[menuInDown_0.15s_ease-out]'} bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded shadow-2xl overflow-hidden min-w-[200px] flex flex-col z-10`}>
          {children}
        </div>
      )}
    </div>
  );
}

// The red line through a title: drawn when the slate goes to the trash,
// lying across it while it is there, rubbed out when it comes back. The
// wrapper around the title carries the row's text size so `top` lands on
// the middle of the first line.
function Strike({ on, top }) {
  return (
    <span
      data-strike
      aria-hidden="true"
      className="absolute left-0 right-0 h-[1.5px] bg-[var(--theme-red)] pointer-events-none"
      style={{ top, marginTop: '-0.75px', transformOrigin: 'left center', transform: on ? 'scaleX(1)' : 'scaleX(0)' }}
    />
  );
}

/**
 * The slate menu both layouts share. Own slates get pin/tags/publish/
 * delete; slates shared with me get the two-step leave.
 */
function SlateMenu({ slate, isOpen, onToggle, onPin, onMoveUp, onMoveDown, onTags, onPublish, onLock, onArchive, onDelete, onRestore, onDeleteForever, onLeave, leaveArmed, onOffload, onCopyToDevice }) {
  const isPinned = Boolean(slate.pinned_at);
  return (
    <DotMenu isOpen={isOpen} onToggle={onToggle}>
          {slate.deleted_at ? (
            <>
              <button onClick={onRestore} className={menuItemCls(false)}>
                <Ico of={UnarchiveIcon} className={menuIcon} />
                {strings.slates.menu.restore}
              </button>
              <button onClick={onDeleteForever} className={menuItemCls(true)}>
                <Ico of={TrashIcon} className={menuIcon} />
                {strings.slates.menu.deleteForever}
              </button>
            </>
          ) : slate.shared ? (
            <button onClick={onLeave} className={menuItemCls(true)}>
              <Ico of={LeaveIcon} className={menuIcon} />
              {leaveArmed ? strings.collab.shared.leaveConfirm : strings.collab.shared.leave}
            </button>
          ) : (
            <>
              <button onClick={onPin} className={menuItemCls(false)}>
                {isPinned ? <Ico of={UnpinIcon} className={menuIcon} /> : <Ico of={PinIcon} className={menuIcon} />}
                {isPinned ? strings.slates.pin.unpin : strings.slates.pin.pin}
              </button>
              {/* A pinned slate can change places with its pinned neighbours */}
              {onMoveUp && (
                <button onClick={onMoveUp} className={menuItemCls(false)}>
                  <Ico of={ArrowUpIcon} className={menuIcon} />
                  {strings.slates.pin.moveUp}
                </button>
              )}
              {onMoveDown && (
                <button onClick={onMoveDown} className={menuItemCls(false)}>
                  <Ico of={ArrowDownIcon} className={menuIcon} />
                  {strings.slates.pin.moveDown}
                </button>
              )}
              <button onClick={onTags} className={menuItemCls(false)}>
                <Ico of={TagIcon} className={menuIcon} />
                {strings.slates.menu.tags}
              </button>
              {/* This device's copy: let it go, or get it. Keeping it past
                  the budget is the check mark's job. A copy with an edit
                  still on its way stays put. */}
              {!slate.local && !slate.pending && (
                <button onClick={slate.available ? onOffload : onCopyToDevice} className={menuItemCls(false)}>
                  {slate.available ? <Ico of={CloudOffIcon} className={menuIcon} /> : <Ico of={CloudDownIcon} className={menuIcon} />}
                  {slate.available ? strings.slates.offline.offload : strings.slates.offline.copy}
                </button>
              )}
              {!slate.is_locked && (
                <button onClick={onPublish} className={menuItemCls(false)}>
                  {slate.is_published ? <Ico of={EyeOffIcon} className={menuIcon} /> : <Ico of={GlobeIcon} className={menuIcon} />}
                  {slate.is_published ? strings.slates.menu.makePrivate : strings.slates.menu.makePublic}
                </button>
              )}
              {/* A private, non-collab slate can lock; a locked one unlocks */}
              {onLock && !slate.is_published && !slate.is_collab && !slate.local && (
                <button onClick={onLock} className={menuItemCls(false)}>
                  {slate.is_locked ? <Ico of={UnlockIcon} className={menuIcon} /> : <Ico of={LockIcon} className={menuIcon} />}
                  {slate.is_locked ? strings.slates.menu.unlock : strings.slates.menu.lock}
                </button>
              )}
              {!slate.local && (
                <button onClick={onArchive} className={menuItemCls(false)}>
                  {slate.archived_at ? <Ico of={UnarchiveIcon} className={menuIcon} /> : <Ico of={ArchiveIcon} className={menuIcon} />}
                  {slate.archived_at ? strings.slates.menu.unarchive : strings.slates.menu.archive}
                </button>
              )}
              <button onClick={onDelete} className={menuItemCls(true)}>
                <Ico of={TrashIcon} className={menuIcon} />
                {strings.slates.menu.delete}
              </button>
            </>
          )}
    </DotMenu>
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
function SlateItem({ slate, layout, onOpen, onTagFilter, menuProps, offline = false, onCopy, onKeep, hit = null, editing = false, drag = null, selecting = false, selected = false }) {
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
  const struckCls = slate.deleted_at ? ' opacity-60' : '';
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
        data-slate={slate.slate_number}
        className={`slate-item is-card ${editing ? 'bg-[var(--theme-bg-tertiary)] border-[var(--theme-text-dim)]' : 'bg-[var(--theme-bg-secondary)] border-[var(--theme-border)]'} border p-4 rounded-lg hover:border-[var(--theme-text-dim)] hover:bg-[var(--theme-bg-tertiary)] transition-all cursor-pointer flex flex-col min-h-[132px]${unavailableCls}`}
      >
        {/* The title is the card: let it wrap to two lines instead of
            truncating at twenty characters, and gather every piece of meta
            at the bottom edge so the box has a top and a floor rather than
            three stray lines. */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            {selecting && <span className={`text-lg leading-none w-5 text-center flex-shrink-0 ${selected ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-dim)]'}`} aria-hidden="true">{selected ? '●' : '○'}</span>}
            {isPinned && <span className="flex-shrink-0 mt-1"><PinGlyph /></span>}
            <div className="relative min-w-0 text-sm md:text-base">
              <h3 className={`text-[var(--theme-text)] font-medium line-clamp-2 break-words${struckCls}`}>{title}</h3>
              <Strike on={Boolean(slate.deleted_at)} top="0.72em" />
            </div>
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

  // Pinned rows can be dragged among the pinned rows
  const dragProps = drag && isPinned ? {
    draggable: true,
    onDragStart: (e) => { e.dataTransfer.effectAllowed = 'move'; drag.start(slate); },
    onDragOver: (e) => { if (drag.over(slate)) e.preventDefault(); },
    onDrop: (e) => { e.preventDefault(); drag.drop(slate); },
    onDragEnd: drag.end,
  } : {};
  return (
    <div
      onClick={open}
      {...dragProps}
      data-slate={slate.slate_number}
      className={`slate-item flex items-start md:items-center gap-3 px-2 py-3.5 ${editing ? 'bg-[var(--theme-bg-secondary)]' : ''} ${drag?.overId === slate.slate_number ? 'bg-[var(--theme-bg-tertiary)]' : ''} hover:bg-[var(--theme-bg-secondary)] cursor-pointer transition-colors${unavailableCls}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {selecting && <span className={`text-lg leading-none w-5 text-center ${selected ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-dim)]'}`} aria-hidden="true">{selected ? '●' : '○'}</span>}
          {isPinned && <PinGlyph />}
          <div className="relative min-w-0 text-sm md:text-base">
            <h3 className={`text-[var(--theme-text)] font-medium truncate min-w-0${struckCls}`}>{title}</h3>
            <Strike on={Boolean(slate.deleted_at)} top="50%" />
          </div>
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

export function SlateManager({ token, userId, onSelectSlate, onNewSlate, onOpenShared, onImport, onTrashed, currentSlateNumber = null }) {
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
  // Editing tags: every tag gets a menu (rename, remove); a rename is typed in place
  const [tagEditing, setTagEditing] = useState(false);
  const [tagEdit, setTagEdit] = useState(null); // { tag, draft }
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Hover that keeps up with scrolling: the browser only settles which row
  // is under the pointer once the wheel stops, so the row under it is
  // marked here on every scroll and pointer move, and styled like a hover
  const scrollRef = useRef(null);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let x = -1, y = -1, marked = null, raf = 0;
    const mark = (row) => {
      if (row === marked) return;
      marked?.removeAttribute('data-hover');
      row?.setAttribute('data-hover', '');
      marked = row;
    };
    const onMove = (e) => { x = e.clientX; y = e.clientY; mark(e.target.closest?.('.slate-item') || null); };
    const onLeave = () => { x = y = -1; mark(null); };
    const onScroll = () => {
      if (x < 0 || raf) return;
      raf = requestAnimationFrame(() => { raf = 0; mark(document.elementFromPoint(x, y)?.closest('.slate-item') || null); });
    };
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => { root.removeEventListener('pointermove', onMove); root.removeEventListener('pointerleave', onLeave); root.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); mark(null); };
  }, [loading]);
  const [goneWay, setGoneWay] = useState(readGone);
  const [tagBusy, setTagBusy] = useState(false);
  const [dragOverId, setDragOverId] = useState(null);
  const dragRef = useRef(null);
  // Select mode: rows toggle instead of opening; the chosen ones export as one file
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [printItems, setPrintItems] = useState(null);
  // Every tag across the library with its count, most used first
  const tagCounts = useMemo(() => {
    const counts = new Map();
    for (const s of [...slates, ...sharedSlates]) { if (s.deleted_at) continue; for (const t of (Array.isArray(s.tags) ? s.tags : [])) counts.set(t, (counts.get(t) || 0) + 1); }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [slates, sharedSlates]);
  const allTags = useMemo(() => tagCounts.map(([t]) => t), [tagCounts]);
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

  // Pinned order: pinned slates sort by pinned_at, newest first, so a new
  // order is a new set of pinned_at values, largest at the top
  const pinnedInOrder = () => slates.filter(s => s.pinned_at && !s.deleted_at && !s.archived_at).sort((a, b) => b.pinned_at - a.pinned_at);
  const applyPinnedOrder = async (ordered) => {
    if (!isOnline()) { showToast(strings.errors.pinFailed); return; }
    const base = Date.now();
    const next = ordered.map((s, i) => ({ n: s.slate_number, at: base - i * 1000 }));
    setSlates(prev => prev.map(s => { const hit = next.find(x => x.n === s.slate_number); return hit ? { ...s, pinned_at: hit.at } : s; }));
    for (const { n, at } of next) {
      try {
        await fetch(`${API_URL}/slates/${n}/metadata`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ pinnedAt: at }),
        });
      } catch (err) { console.error('pin order failed:', err); }
    }
  };
  const movePinned = async (slate, dir, e) => {
    e?.stopPropagation?.(); e?.preventDefault?.();
    setOpenMenuId(null);
    const list = pinnedInOrder();
    const i = list.findIndex(s => s.slate_number === slate.slate_number);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const ordered = [...list];
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    await applyPinnedOrder(ordered);
  };
  const drag = {
    overId: dragOverId,
    start: (slate) => { dragRef.current = slate; },
    over: (slate) => { const ok = !!dragRef.current && dragRef.current.slate_number !== slate.slate_number; if (ok && dragOverId !== slate.slate_number) setDragOverId(slate.slate_number); return ok; },
    drop: (target) => {
      const from = dragRef.current;
      dragRef.current = null;
      setDragOverId(null);
      if (!from || from.slate_number === target.slate_number) return;
      const list = pinnedInOrder().filter(s => s.slate_number !== from.slate_number);
      const at = list.findIndex(s => s.slate_number === target.slate_number);
      list.splice(at < 0 ? list.length : at, 0, from);
      applyPinnedOrder(list);
    },
    end: () => { dragRef.current = null; setDragOverId(null); },
  };

  // Tag management: rename (a name already in use merges), or remove, across
  // every slate that carries the tag. Tags are encrypted per slate, so each
  // one is rewritten in the browser and sent on its own.
  const retag = async (fn) => {
    if (!isOnline()) { showToast(strings.slates.tags.needsNetwork); return 0; }
    const master = await getSlateKey(userId);
    if (!master) { showToast(strings.slates.tags.unlockRequired); return 0; }
    let touched = 0;
    for (const slate of slates) {
      const tags = Array.isArray(slate.tags) ? slate.tags : [];
      const next = [...new Set(fn(tags))];
      if (next.length === tags.length && next.every((t, i) => t === tags[i])) continue;
      let key = master;
      if (slate.is_collab && slate.collab_wrapped_key) { try { key = await unwrapKey(slate.collab_wrapped_key, master); } catch { /* master */ } }
      const encryptedTags = next.length ? await encryptTags(next, key) : null;
      const r = await fetch(`${API_URL}/slates/${slate.slate_number}/metadata`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ encryptedTags }),
      });
      if (!r.ok) continue;
      touched++;
      setSlates(prev => prev.map(s => (s.slate_number === slate.slate_number ? { ...s, tags: next } : s)));
    }
    return touched;
  };
  const renameTag = async (from, toRaw) => {
    const to = normalizeTag(toRaw);
    if (!to || to === from) { setTagEdit(null); return; }
    setTagBusy(true);
    try {
      await retag(tags => tags.map(t => (t === from ? to : t)));
      if (tagFilter === from) setTagFilter(to);
    } finally { setTagBusy(false); setTagEdit(null); }
  };
  const removeTagEverywhere = async (tag) => {
    setTagBusy(true);
    try {
      await retag(tags => tags.filter(t => t !== tag));
      if (tagFilter === tag) setTagFilter(null);
    } finally { setTagBusy(false); }
  };

  // Export the selected slates: one file, or a zip with a file per slate.
  // Each is fetched and decrypted here; a locked slate whose lock is shut is
  // left out and counted.
  const toggleSelected = (n) => setSelected(prev => { const next = new Set(prev); if (next.has(n)) next.delete(n); else next.add(n); return next; });
  const endSelecting = () => { setSelecting(false); setSelected(new Set()); };
  const gatherSelected = async () => {
    const master = await getSlateKey(userId);
    if (!master) throw new Error('locked');
    const rows = filteredAndSortedSlates.filter(s => selected.has(s.slate_number) && !s.shared);
    const items = [];
    let skipped = 0;
    for (const row of rows) {
      let key = master;
      if (row.is_locked) { key = openLockKey(row.slate_number); if (!key) { skipped++; continue; } }
      else if (row.is_collab && row.collab_wrapped_key) { try { key = await unwrapKey(row.collab_wrapped_key, master); } catch { skipped++; continue; } }
      try {
        const res = await fetch(`${API_URL}/slates/${row.slate_number}`, { credentials: 'include' });
        if (!res.ok) throw new Error('fetch failed');
        const data = await res.json();
        const text = data.encryptedContent ? await decryptContent(data.encryptedContent, key) : (data.content || '');
        items.push({ title: row.title || strings.slates.untitled, text, created: data.created_at, updated: data.updated_at, tags: Array.isArray(row.tags) ? row.tags : [], rich: data.editor_mode === 'wysiwyg' });
      } catch (err) { console.error('export: slate skipped', row.slate_number, err); skipped++; }
    }
    return { items, skipped };
  };
  // The rows go one after another, a beat apart, and the whole lot is
  // awaited; the beat shrinks so a long list does not take all day
  const stagger = (items, fn) => Promise.all(items.map((item, i) => new Promise(r => setTimeout(r, Math.min(i * 45, 600))).then(() => fn(item))));
  // The selection, acted on as one: what a row's menu does, for every
  // chosen row, then the selection ends
  const bulk = async (fn) => {
    if (!selected.size || bulkBusy) return;
    setBulkBusy(true);
    try { await stagger(filteredAndSortedSlates.filter(s => selected.has(s.slate_number) && !s.shared), fn); endSelecting(); }
    finally { setBulkBusy(false); }
  };
  const exportSelected = async (format) => {
    if (!selected.size || exporting) return;
    setExporting(true);
    try {
      const { items, skipped } = await gatherSelected();
      if (skipped) showToast(strings.slates.select.skippedLocked(skipped));
      if (!items.length) { if (!skipped) showToast(strings.slates.select.nothing); return; }
      if (format === 'pdf') { setPrintItems(items); return; }
      const type = format === 'md' ? 'text/markdown' : 'text/plain';
      if (items.length === 1) downloadText(format === 'md' ? markdownOf(items[0]) : items[0].text, fileNameFor(items[0].title, format), type);
      else downloadBlob(await zipOf(items, format), `justtype-export-${new Date().toISOString().split('T')[0]}.zip`);
      endSelecting();
    } catch (err) {
      showToast(err?.message === 'locked' ? strings.slates.tags.unlockRequired : strings.errors.loadFailed);
    } finally { setExporting(false); }
  };
  // Print the gathered slates: a page each, the rendered view for rich ones
  useEffect(() => {
    if (!printItems) return;
    let cancelled = false;
    document.body.dataset.printing = '';
    const done = () => { setPrintItems(null); endSelecting(); };
    window.addEventListener('afterprint', done, { once: true });
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
    return () => { cancelled = true; delete document.body.dataset.printing; window.removeEventListener('afterprint', done); };
  }, [printItems]);

  // Delete: to the trash, with a word to bring it straight back. Restore
  // and delete forever act on what is in the trash; empty trash clears it.
  const markDeleted = (n, deletedAt) => setSlates(prev => prev.map(s => (s.slate_number === n ? { ...s, deleted_at: deletedAt } : s)));
  const restoreSlate = async (slate, e) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    setOpenMenuId(null);
    const back = unstrike(slate.slate_number);
    try {
      const r = await fetch(`${API_URL}/slates/${slate.slate_number}/restore`, { method: 'POST', credentials: 'include' });
      if (!r.ok) throw new Error('restore failed');
      await back.done;
      markDeleted(slate.slate_number, null);
    } catch (err) {
      back.cancel();
      console.error('Failed to restore slate:', err);
    }
  };
  // The pieces the trash motion works on, or nothing when motion is off
  const PENCIL = 'cubic-bezier(0.55, 0.05, 0.25, 1)';
  const strikeParts = (n) => {
    const el = document.querySelector(`[data-slate="${n}"]`);
    if (!el || !el.animate || motionOff()) return null;
    return { el, line: el.querySelector('[data-strike]'), title: el.querySelector('h3') };
  };
  // A row folding away: its height, padding and borders go to nothing so
  // the rows below glide up, while what is on it does `keyframes`
  const fold = (el, keyframes, opts) => {
    const style = getComputedStyle(el);
    const open = { height: `${el.getBoundingClientRect().height}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, borderTopWidth: style.borderTopWidth, borderBottomWidth: style.borderBottomWidth };
    const shut = { height: '0px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px' };
    el.style.overflow = 'hidden';
    el.style.pointerEvents = 'none';
    return el.animate(keyframes.map((k, i) => ({ ...k, ...(i === keyframes.length - 1 ? shut : open) })), { fill: 'forwards', ...opts });
  };
  // A slate coming back from the trash: the red line across its title is
  // rubbed out from right to left and the title brightens as it goes; then
  // the row lifts out of the trash, fading as its box closes under it and
  // the rows below rise. Returns the moment the row is gone, and a way to
  // leave it as it was if the server said no.
  const unstrike = (n) => {
    const p = strikeParts(n);
    if (!p) return { done: Promise.resolve(), cancel: () => {} };
    const { el, line, title } = p;
    const ERASE = 380;
    const LIFT = 220;
    if (line) line.style.transformOrigin = 'right center';
    const erase = line?.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: ERASE, easing: PENCIL, fill: 'forwards' });
    const wake = title?.animate([{ opacity: 0.6 }, { opacity: 1 }], { duration: ERASE, easing: 'ease-out', fill: 'forwards' });
    const lift = fold(el, [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-6px)', opacity: 0 }], { duration: LIFT, delay: ERASE + 60, easing: 'cubic-bezier(0.55, 0, 0.85, 0.3)' });
    const done = new Promise((resolve) => { lift.onfinish = resolve; lift.oncancel = resolve; });
    const cancel = () => {
      erase?.cancel(); wake?.cancel(); lift.cancel();
      if (line) line.style.transformOrigin = 'left center';
      el.style.pointerEvents = ''; el.style.overflow = '';
    };
    return { done, cancel };
  };
  // A slate leaving for the trash: the red line is drawn across its title
  // the way a pencil draws, slow off the mark, quick through the middle,
  // easing to a stop, and the title dims under it; once the server has
  // agreed and the line is drawn, the row is squished flat from the top,
  // fast, the rows below gliding up, and the word `trash` gives one small
  // nod. The same in both layouts. Returns the strike, the squish to call
  // when the server says yes, and a way to leave the row if it says no.
  const strikeOut = (n) => {
    const still = { struck: Promise.resolve(), squish: async () => {}, cancel: () => {} };
    const p = strikeParts(n);
    if (!p) return still;
    const { el, line, title } = p;
    const target = document.querySelector('[data-choice="trash"]');
    const DRAW = 440;
    const HOLD = 70;
    const SQUISH = 200;
    el.style.pointerEvents = 'none';
    const strike = line?.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: DRAW, easing: PENCIL, fill: 'forwards' });
    const dim = title?.animate([{ opacity: 1 }, { opacity: 0.6 }], { duration: DRAW, easing: 'ease-in', fill: 'forwards' });
    const struck = strike ? new Promise((resolve) => { strike.onfinish = resolve; strike.oncancel = resolve; }) : Promise.resolve();
    let shut = null;
    const squish = () => {
      el.style.transformOrigin = 'center top';
      shut = fold(el, [{ transform: 'scaleY(1)', opacity: 1 }, { transform: 'scaleY(0)', opacity: 0 }], { duration: SQUISH, delay: HOLD, easing: 'cubic-bezier(0.6, 0, 0.9, 0.3)' });
      // One nod: up quickly and slowing, down under gravity
      target?.animate([
        { transform: 'translateY(0)', easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)' },
        { transform: 'translateY(-5px)', offset: 0.42, easing: 'cubic-bezier(0.55, 0, 0.8, 0.4)' },
        { transform: 'translateY(0)' },
      ], { duration: 320, delay: HOLD });
      return new Promise((resolve) => { shut.onfinish = resolve; shut.oncancel = resolve; });
    };
    const cancel = () => {
      strike?.cancel(); dim?.cancel(); shut?.cancel();
      el.style.pointerEvents = ''; el.style.overflow = ''; el.style.transformOrigin = '';
    };
    return { struck, squish, cancel };
  };
  const trashSlate = async (slate, e) => {
    e?.stopPropagation();
    e?.preventDefault();
    setOpenMenuId(null);
    const fx = strikeOut(slate.slate_number);
    try {
      const r = await fetch(`${API_URL}/slates/${slate.slate_number}`, { method: 'DELETE', credentials: 'include' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { fx.cancel(); return; }
      await fx.struck;
      await fx.squish();
      markDeleted(slate.slate_number, data.deleted_at || Math.floor(Date.now() / 1000));
      onTrashed?.(slate.slate_number);
    } catch (err) {
      fx.cancel();
      console.error('Failed to delete slate:', err);
    }
  };
  const deleteForever = async (slate, e) => {
    e?.stopPropagation();
    e?.preventDefault();
    setOpenMenuId(null);
    const fx = goneForever(document.querySelector(`[data-slate="${slate.slate_number}"]`));
    try {
      const r = await fetch(`${API_URL}/slates/${slate.slate_number}?forever=1`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) { fx.cancel(); return; }
      await fx.done;
      setSlates(prev => prev.filter(s => s.slate_number !== slate.slate_number));
    } catch (err) {
      fx.cancel();
      console.error('Failed to delete slate:', err);
    }
  };
  const emptyTrash = async () => {
    if (!confirmEmpty) { setConfirmEmpty(true); setTimeout(() => setConfirmEmpty(false), 3000); return; }
    setConfirmEmpty(false);
    try {
      const r = await fetch(`${API_URL}/slates/trash`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) throw new Error('empty failed');
      await stagger(filteredAndSortedSlates, (slate) => goneForever(document.querySelector(`[data-slate="${slate.slate_number}"]`)).done);
      setSlates(prev => prev.filter(s => !s.deleted_at));
    } catch (err) {
      console.error('Failed to empty the trash:', err);
    }
  };

  // Archive: the slate leaves the list for the archived section, and comes
  // back the same way. Nothing else about it changes.
  const toggleArchive = async (slate, e) => {
    e?.stopPropagation();
    e?.preventDefault();
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
    <div ref={scrollRef} className="h-full overflow-y-auto">
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

        {/* Search with the verbs and the two layouts after it, as words and
            glyphs; sort and show on the line below; tags on a line of their own */}
        {hasAnySlates && (
          <div className="sticky top-0 z-20 -mt-2 pt-2 pb-3 mb-3 bg-[var(--theme-bg)] flex flex-col gap-3">
            {/* The list slides under a short fade rather than a hard edge */}
            <div aria-hidden="true" className="absolute left-0 right-0 top-full h-4 bg-gradient-to-b from-[var(--theme-bg)] to-transparent pointer-events-none" />
            <div className="flex items-center gap-4">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={strings.slates.searchPlaceholder}
                className="flex-1 min-w-0 h-10 bg-transparent border-b border-[var(--theme-border)] px-0 focus:outline-none focus:border-[var(--theme-text-dim)] transition-colors text-[var(--theme-text)] text-sm placeholder-[var(--theme-text-dim)]"
              />
              {/* import, then select: select turns into done in place, so it
                  sits last among the words and nothing before it moves */}
              <div className="flex items-center gap-x-3 flex-shrink-0 text-xs md:text-sm">
                {onImport && (
                  <>
                    <button onClick={onImport} className="inline-flex items-center gap-1.5 text-[var(--theme-text-dim)] hover:text-[var(--theme-text)] transition-colors">
                      <Ico of={ImportIcon} className="w-3.5 h-3.5" />
                      {strings.slates.importer.start}
                    </button>
                    <span className="opacity-30">·</span>
                  </>
                )}
                <button
                  onClick={() => (selecting ? endSelecting() : setSelecting(true))}
                  className={`inline-flex items-center gap-1.5 transition-colors ${selecting ? 'text-[var(--theme-text)]' : 'text-[var(--theme-text-dim)] hover:text-[var(--theme-text)]'}`}
                >
                  <Ico of={SelectIcon} className="w-3.5 h-3.5" />
                  <TextMorph>{selecting ? strings.slates.select.done : strings.slates.select.start}</TextMorph>
                </button>
                {/* The two layouts (desktop only: both are one column on a
                    phone, so there was nothing to switch) */}
                <span className="hidden md:inline-flex items-center gap-x-2 ml-2">
                  {[
                    ['list', strings.slates.viewToggle.list, <><rect x="1" y="2" width="14" height="2" rx="0.5"/><rect x="1" y="7" width="14" height="2" rx="0.5"/><rect x="1" y="12" width="14" height="2" rx="0.5"/></>],
                    ['grid', strings.slates.viewToggle.grid, <><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></>],
                  ].map(([mode, title, shape]) => (
                    <button
                      key={mode}
                      onClick={() => withViewTransition(() => setViewMode(mode))}
                      aria-label={title}
                      className={`p-1 transition-colors ${viewMode === mode ? 'text-[var(--theme-text)]' : 'text-[var(--theme-text-dim)] hover:text-[var(--theme-text)]'}`}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">{shape}</svg>
                    </button>
                  ))}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs md:text-sm">
              <ChoiceRow
                swipe
                icon={SortIcon}
                label={strings.slates.sortLabel}
                options={SORT_OPTIONS}
                value={sortBy}
                onChange={setSortBy}
              />
              <ChoiceRow
                swipe
                icon={EyeIcon}
                label={strings.slates.filterVisibility}
                options={[
                  { id: 'all', label: strings.slates.filterVisibilityAll },
                  { id: 'public', label: strings.slates.filterVisibilityPublic },
                  { id: 'private', label: strings.slates.filterVisibilityPrivate },
                  { id: 'archived', label: strings.slates.filterVisibilityArchived },
                  { id: 'trash', label: strings.slates.filterVisibilityTrash, tone: 'danger' },
                ]}
                value={visibilityFilter}
                onChange={setVisibilityFilter}
              />
              {hasCollabSlates && (
                <ChoiceRow
                  swipe
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
                  swipe
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
            {/* Every tag in the library, a row of its own under sort and show.
                Editing adds a small menu after each tag (rename in place, or
                remove from every slate); the menus grow in beside the words,
                which stay where they are. */}
            {allTags.length > 0 && (
              <div className="mt-2 flex items-start gap-x-3 text-xs md:text-sm">
                <ScrollRow className="flex-1 min-w-0" wrap={tagEditing}>
                <ChoiceRow
                  nowrap={!tagEditing}
                  icon={TagIcon}
                  label={strings.slates.tags.rowLabel}
                  className={tagBusy ? 'opacity-60 pointer-events-none' : ''}
                  options={[
                    { id: ALL_TAGS, label: strings.slates.tags.all },
                    ...allTags.map(tag => (tagEdit?.tag === tag ? {
                      id: tag,
                      node: (
                        <input
                          autoFocus
                          value={tagEdit.draft}
                          onChange={(e) => setTagEdit({ tag, draft: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') renameTag(tag, tagEdit.draft);
                            if (e.key === 'Escape') { e.stopPropagation(); setTagEdit(null); }
                          }}
                          onBlur={() => setTagEdit(null)}
                          maxLength={MAX_TAG_LENGTH}
                          size={Math.max(4, tagEdit.draft.length + 1)}
                          className="bg-transparent border-b border-[var(--theme-text-dim)] text-[var(--theme-text)] focus:outline-none"
                        />
                      ),
                    } : { id: tag, label: `#${tag}`, title: tag })),
                  ]}
                  value={tagFilter && allTags.includes(tagFilter) ? tagFilter : ALL_TAGS}
                  onChange={(id) => setTagFilter(id === ALL_TAGS ? null : id)}
                  after={(o) => o.id !== ALL_TAGS && (
                    <span
                      className="inline-flex items-center"
                      aria-hidden={!tagEditing}
                      style={{
                        width: tagEditing ? '1rem' : 0,
                        marginLeft: tagEditing ? '-0.5rem' : '-0.75rem',
                        opacity: tagEditing ? 1 : 0,
                        overflow: tagEditing ? 'visible' : 'hidden',
                        transition: 'width 250ms ease-out, margin-left 250ms ease-out, opacity 250ms ease-out',
                      }}
                    >
                      <DotMenu small isOpen={openMenuId === `tag:${o.id}`} onToggle={(e) => toggleMenu(`tag:${o.id}`, e)}>
                        <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); setTagEdit({ tag: o.id, draft: o.id }); }} className={menuItemCls(false)}>
                          {strings.slates.tags.rename}
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); removeTagEverywhere(o.id); }} className={menuItemCls(true)}>
                          {strings.slates.tags.remove}
                        </button>
                      </DotMenu>
                    </span>
                  )}
                />
                </ScrollRow>
                <span className="opacity-30 flex-shrink-0">·</span>
                <button onClick={() => { setTagEditing(!tagEditing); setTagEdit(null); }} className="flex-shrink-0 text-[var(--theme-text)] hover:opacity-70 transition-opacity">
                  {tagEditing ? strings.slates.tags.done : strings.slates.tags.edit}
                </button>
              </div>
            )}
            {selecting && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs md:text-sm text-[var(--theme-text-dim)]">
                <span>{strings.slates.select.count(selected.size)}</span>
                <span className="opacity-30">·</span>
                <span>{strings.slates.select.exportAs}</span>
                {['txt', 'md', 'pdf'].map(f => (
                  <button key={f} onClick={() => exportSelected(f)} disabled={!selected.size || exporting} className="hover:text-[var(--theme-text)] transition-colors disabled:opacity-40 disabled:hover:text-[var(--theme-text-dim)]">
                    {strings.slates.select[f]}
                  </button>
                ))}
                {/* What a row's menu offers, for the whole selection: in the
                    trash that is restore and delete forever, elsewhere
                    archive (or unarchive) and delete */}
                {(visibilityFilter === 'trash'
                  ? [[strings.slates.menu.restore, restoreSlate, false], [strings.slates.menu.deleteForever, deleteForever, true]]
                  : [[visibilityFilter === 'archived' ? strings.slates.menu.unarchive : strings.slates.menu.archive, toggleArchive, false], [strings.slates.menu.delete, trashSlate, true]]
                ).map(([word, act, danger]) => (
                  <React.Fragment key={word}>
                    <span className="opacity-30">·</span>
                    <button onClick={() => bulk(act)} disabled={!selected.size || bulkBusy} className={`transition-colors disabled:opacity-40 ${danger ? 'text-[var(--theme-red)] hover:opacity-70' : 'hover:text-[var(--theme-text)] disabled:hover:text-[var(--theme-text-dim)]'}`}>
                      {word}
                    </button>
                  </React.Fragment>
                ))}
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
              drag={effectiveViewMode === 'list' && !slate.shared && !slate.deleted_at ? drag : null}
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
              selecting={selecting && !slate.shared}
              selected={selected.has(slate.slate_number)}
              onOpen={() => (selecting ? (!slate.shared && toggleSelected(slate.slate_number)) : slate.shared ? (onOpenShared && onOpenShared(slate.sharedSlateId)) : onSelectSlate(slate))}
              onTagFilter={setTagFilter}
              menuProps={{
                isOpen: openMenuId === slate.slate_number,
                onToggle: (e) => toggleMenu(slate.slate_number, e),
                onPin: (e) => togglePin(slate, e),
                onMoveUp: slate.pinned_at && pinnedInOrder().findIndex(s => s.slate_number === slate.slate_number) > 0 ? (e) => movePinned(slate, -1, e) : null,
                onMoveDown: slate.pinned_at && (() => { const l = pinnedInOrder(); const i = l.findIndex(s => s.slate_number === slate.slate_number); return i >= 0 && i < l.length - 1; })() ? (e) => movePinned(slate, 1, e) : null,
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
      {/* Under the trash: the one way to empty it, asked twice */}
      {visibilityFilter === 'trash' && filteredAndSortedSlates.length > 0 && (
        <div className="flex justify-between items-center gap-3 mt-4 text-xs md:text-sm">
          {/* Lab: five ways a slate can go for good; keep one, drop the row */}
          <ChoiceRow label="gone:" options={GONE_WAYS.map(w => ({ id: w, label: w }))} value={goneWay} onChange={(w) => { writeGone(w); setGoneWay(w); }} />
          <button onClick={emptyTrash} className="text-[var(--theme-red)] hover:opacity-70 transition-opacity">
            {confirmEmpty ? strings.slates.trash.emptyConfirm : strings.slates.trash.empty}
          </button>
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
      {printItems && createPortal(
        <div className="print-root">
          {printItems.map((it, i) => (
            <div key={i} className={i < printItems.length - 1 ? 'print-break' : ''}>
              <h1 className="print-title">{it.title}</h1>
              {it.rich ? (
                <React.Suspense fallback={<pre className="print-fallback">{it.text}</pre>}>
                  <MarkdownViewLazy content={it.text} />
                </React.Suspense>
              ) : <pre>{it.text}</pre>}
            </div>
          ))}
        </div>,
        document.body
      )}
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
