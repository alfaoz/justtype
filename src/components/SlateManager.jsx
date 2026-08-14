import React, { useMemo, useState, useEffect, useRef } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';
import { decryptContent, decryptTags, decryptTitle, encryptTags, encryptTitle, unwrapKey } from '../crypto';
import { getSlateKey } from '../keyStore';
import { fetchInvites, acceptInvite, declineInvite, fetchSharedSlates, leaveSharedSlate } from '../collab';

const TAG_REGEX = /^[a-z0-9]+$/;
const MAX_TAG_LENGTH = 24;
const MAX_TAGS_PER_SLATE = 20;

export function SlateManager({ token, userId, onSelectSlate, onNewSlate, onOpenShared }) {
  const [slates, setSlates] = useState([]);
  const [loading, setLoading] = useState(true);
  // E2EE collaboration: invites waiting on me + slates others shared with me
  const [collabInvites, setCollabInvites] = useState([]);
  const [sharedSlates, setSharedSlates] = useState([]);
  const [collabBusyId, setCollabBusyId] = useState(null);
  const [leaveConfirmId, setLeaveConfirmId] = useState(null);
  const leaveTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(leaveTimerRef.current), []);
  const [deleteModal, setDeleteModal] = useState({ show: false, slateId: null, slateTitle: '' });
  const [openMenuId, setOpenMenuId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent'); // 'recent' | 'oldest' | 'a-z' | 'z-a' | 'words'
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('justtype-slate-view') || 'list'); // 'list' | 'grid'
  const [tagFilter, setTagFilter] = useState(null);
  const [appFilter, setAppFilter] = useState(null); // source_app client_id, or null for all
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
      const response = await fetch(`${API_URL}/slates`, {
        credentials: 'include'
      });
      let data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || strings.errors.loadFailed);
      }

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
        const needsMigration = data.filter(s => !s.is_published && !s.encrypted_title && s.title);
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
    } catch (err) {
      console.error('Failed to load slates:', err);
    } finally {
      setLoading(false);
    }
  };

  const showDeleteConfirmation = (id, title, e) => {
    e.stopPropagation();
    e.preventDefault();
    setDeleteModal({ show: true, slateId: id, slateTitle: title });
  };

  const cancelDelete = () => {
    setDeleteModal({ show: false, slateId: null, slateTitle: '' });
  };

  const confirmDelete = async () => {
    const id = deleteModal.slateId;

    // Close modal immediately
    setDeleteModal({ show: false, slateId: null, slateTitle: '' });

    try {
      const response = await fetch(`${API_URL}/slates/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        setSlates(prevSlates => prevSlates.filter(s => s.slate_number !== id));
      } else {
        const data = await response.json();
        alert(data.error || strings.errors.deleteSlate);
      }
    } catch (err) {
      console.error('Failed to delete slate:', err);
      alert(strings.errors.deleteSlate);
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
        alert(data.error || strings.errors.pinFailed);
      }
    } catch (err) {
      console.error('Failed to toggle pin:', err);
      alert(strings.errors.pinFailed);
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
    setTagsModal({ show: false, slateId: null, slateTitle: '', tags: [] });
    setTagInput('');
    setTagError('');
    setTagsSaving(false);
  };

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
            alert(slateData.error || strings.errors.loadFailed);
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
        alert(strings.slates.unlockRequired);
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
        alert(data.error || strings.errors.publishFailed);
      }
    } catch (err) {
      console.error('Failed to toggle publish:', err);
      alert(strings.errors.publishFailed);
    }
  };

  const toggleMenu = (id, e) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenMenuId(openMenuId === id ? null : id);
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatDateShort = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Distinct apps that have created (dropped) slates, for the "from app" filter.
  const sourceApps = useMemo(() => {
    const map = new Map(); // client_id -> display name
    for (const s of slates) {
      if (s.source_app) map.set(s.source_app, s.source_app_name || s.source_app);
    }
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [slates]);

  const filteredAndSortedSlates = useMemo(() => {
    const q = debouncedSearchQuery.trim().toLowerCase();
    const activeTag = tagFilter;

    const filtered = slates.filter(slate => {
      const tags = Array.isArray(slate.tags) ? slate.tags : [];

      if (appFilter && slate.source_app !== appFilter) {
        return false;
      }

      if (collabFilter && !slate.is_collab) {
        return false;
      }

      if (activeTag && !tags.includes(activeTag)) {
        return false;
      }

      if (!q) return true;

      const title = (slate.title || '').toString().toLowerCase();
      if (title.includes(q)) return true;

      return tags.some(t => (t || '').toString().toLowerCase().includes(q));
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
  }, [slates, debouncedSearchQuery, tagFilter, appFilter, collabFilter, sortBy]);

  // Drop the app filter if the matching app no longer has any slates (e.g. all deleted).
  useEffect(() => {
    if (appFilter && !sourceApps.some(a => a.id === appFilter)) setAppFilter(null);
  }, [appFilter, sourceApps]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#666]">{strings.slates.loading}</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="flex justify-between items-center mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl text-white">{strings.slates.title}</h1>
          <button
            onClick={onNewSlate}
            className="border border-[#333] px-4 md:px-6 py-2 rounded hover:bg-[#e5e5e5] hover:text-black hover:border-[#e5e5e5] transition-all duration-300 text-xs md:text-sm"
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

        {/* Slates shared with me */}
        {sharedSlates.length > 0 && (
          <div className="mb-6">
            <p className="text-xs text-[var(--theme-text-dim)] mb-2">{strings.collab.shared.title}</p>
            <div className="flex flex-col gap-2">
              {sharedSlates.map((s) => (
                <div key={s.slateId} className="flex items-center justify-between gap-3 p-3 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded hover:border-[var(--theme-text-dim)] transition-colors">
                  <button onClick={() => onOpenShared && onOpenShared(s.slateId)} className="min-w-0 text-left flex-1">
                    <span className="text-sm text-[var(--theme-text)] truncate block">{s.title || strings.slates.untitled}</span>
                    <span className="text-xs text-[var(--theme-text-dim)]">
                      {strings.collab.shared.by(s.owner)} · {strings.slates.stats.wordsShort(s.wordCount || 0)}
                      {s.tags && s.tags.length > 0 ? ` · ${s.tags.join(', ')}` : ''}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      clearTimeout(leaveTimerRef.current);
                      if (leaveConfirmId === s.slateId) {
                        handleLeaveShared(s.slateId);
                      } else {
                        setLeaveConfirmId(s.slateId);
                        leaveTimerRef.current = setTimeout(() => setLeaveConfirmId(null), 3000);
                      }
                    }}
                    disabled={collabBusyId === `leave-${s.slateId}`}
                    className={`text-xs transition-colors flex-shrink-0 disabled:opacity-50 ${leaveConfirmId === s.slateId ? 'text-[var(--theme-red)]' : 'text-[var(--theme-text-dim)] hover:text-[var(--theme-red)]'}`}
                  >
                    {leaveConfirmId === s.slateId ? strings.collab.shared.leaveConfirm : strings.collab.shared.leave}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search + Sort + Filters */}
        {slates.length > 0 && (
          <div className="flex flex-col gap-3 mb-6">
            <div className="flex flex-col md:flex-row gap-3 md:items-center">
              {/* Search */}
              <div className="flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={strings.slates.searchPlaceholder}
                  className="w-full h-10 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded px-4 focus:outline-none focus:border-[var(--theme-text-dim)] text-[var(--theme-text)] text-sm placeholder-[var(--theme-text-dim)]"
                />
              </div>

              {/* Active tag filter */}
              {tagFilter && (
                <button
                  onClick={() => setTagFilter(null)}
                  className="h-10 px-3 rounded border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] text-[var(--theme-text)] hover:bg-[var(--theme-bg-tertiary)] hover:border-[var(--theme-text-dim)] transition-colors text-xs md:text-sm whitespace-nowrap"
                  title={strings.slates.tags.filterLabel(tagFilter)}
                >
                  {strings.slates.tags.filterLabel(tagFilter)} <span className="text-[var(--theme-text-dim)] ml-2">x</span>
                </button>
              )}

              {/* View Mode Toggle */}
              <div className="flex items-center border border-[var(--theme-border)] rounded overflow-hidden h-10 flex-shrink-0">
                <button
                  onClick={() => setViewMode('list')}
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
                  onClick={() => setViewMode('grid')}
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

            {/* Sort */}
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-[var(--theme-text-dim)]">{strings.slates.sortLabel}</span>
              {[
                { id: 'recent', label: strings.slates.sortOptions.recent },
                { id: 'oldest', label: strings.slates.sortOptions.oldest },
                { id: 'a-z', label: strings.slates.sortOptions.az },
                { id: 'z-a', label: strings.slates.sortOptions.za },
                { id: 'words', label: strings.slates.sortOptions.words },
              ].map(option => (
                <button
                  key={option.id}
                  onClick={() => setSortBy(option.id)}
                  className={`h-8 px-3 rounded border transition-colors text-xs md:text-sm ${
                    sortBy === option.id
                      ? 'bg-[var(--theme-bg-tertiary)] border-[var(--theme-border)] text-[var(--theme-text)]'
                      : 'bg-transparent border-[var(--theme-border)] text-[var(--theme-text-dim)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg-tertiary)] hover:border-[var(--theme-text-dim)]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {/* Filter by collab status (only when collaborative slates exist) */}
            {slates.some(s => s.is_collab) && (
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <span className="text-[var(--theme-text-dim)]">{strings.collab.filter.label}</span>
                {[
                  { on: false, label: strings.collab.filter.all },
                  { on: true, label: strings.collab.filter.collab },
                ].map(option => (
                  <button
                    key={option.label}
                    onClick={() => setCollabFilter(option.on)}
                    className={`h-8 px-3 rounded border transition-colors text-xs md:text-sm ${
                      collabFilter === option.on
                        ? 'bg-[var(--theme-bg-tertiary)] border-[var(--theme-border)] text-[var(--theme-text)]'
                        : 'bg-transparent border-[var(--theme-border)] text-[var(--theme-text-dim)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg-tertiary)] hover:border-[var(--theme-text-dim)]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}

            {/* Filter by source app (only when app-created slates exist) */}
            {sourceApps.length > 0 && (
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <span className="text-[var(--theme-text-dim)]">{strings.slates.filterByApp}</span>
                <button
                  onClick={() => setAppFilter(null)}
                  className={`h-8 px-3 rounded border transition-colors text-xs md:text-sm ${
                    !appFilter
                      ? 'bg-[var(--theme-bg-tertiary)] border-[var(--theme-border)] text-[var(--theme-text)]'
                      : 'bg-transparent border-[var(--theme-border)] text-[var(--theme-text-dim)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg-tertiary)] hover:border-[var(--theme-text-dim)]'
                  }`}
                >
                  {strings.slates.filterAllApps}
                </button>
                {sourceApps.map(app => (
                  <button
                    key={app.id}
                    onClick={() => setAppFilter(app.id)}
                    title={app.name}
                    className={`h-8 px-3 rounded border transition-colors text-xs md:text-sm max-w-[12rem] truncate ${
                      appFilter === app.id
                        ? 'bg-[var(--theme-bg-tertiary)] border-[var(--theme-border)] text-[var(--theme-green)]'
                        : 'bg-transparent border-[var(--theme-border)] text-[var(--theme-text-dim)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg-tertiary)] hover:border-[var(--theme-text-dim)]'
                    }`}
                  >
                    {app.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

      {slates.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[#666] mb-4 text-sm md:text-base">{strings.slates.empty.message}</p>
          <button
            onClick={onNewSlate}
            className="text-white hover:underline text-sm md:text-base"
          >
            {strings.slates.empty.cta}
          </button>
        </div>
      ) : filteredAndSortedSlates.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[#666] text-sm md:text-base">{strings.slates.noMatches(searchQuery)}</p>
        </div>
      ) : viewMode === 'list' ? (
        /* List View */
        <div className="space-y-3">
          {filteredAndSortedSlates.map((slate) => {
            const isPinned = Boolean(slate.pinned_at);
            const tags = Array.isArray(slate.tags) ? slate.tags : [];
            const visibleTags = tags.slice(0, 4);
            const remainingTagCount = Math.max(0, tags.length - visibleTags.length);

            const status = slate.is_published
              ? { label: strings.slates.status.public, className: 'text-[var(--theme-blue)] border-[var(--theme-border)] bg-[var(--theme-bg-tertiary)]' }
              : slate.published_at
                ? { label: strings.slates.status.wasPublic, className: 'text-[var(--theme-orange)] border-[var(--theme-border)] bg-[var(--theme-bg-tertiary)]' }
                : { label: strings.slates.status.private, className: 'text-[var(--theme-text-muted)] border-[var(--theme-border)] bg-[var(--theme-bg-tertiary)]' };

            return (
              <div
                key={slate.slate_number}
                onClick={() => onSelectSlate(slate)}
                className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] p-4 rounded-lg hover:border-[var(--theme-text-dim)] hover:bg-[var(--theme-bg-tertiary)] transition-all cursor-pointer group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isPinned && (
                      <svg className="w-3.5 h-3.5 text-[var(--theme-text-dim)] flex-shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <path d="M10 1.5c0-.3-.2-.5-.5-.5h-3c-.3 0-.5.2-.5.5V6L4 8v1h3v5l1-1 1 1V9h3V8l-2-2V1.5z" />
                      </svg>
                    )}
                    <h3 className="text-[var(--theme-text)] text-sm md:text-base font-medium truncate flex-1">
                      {slate.title || strings.slates.untitled}
                    </h3>
                  </div>

                  <div className="relative flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => toggleMenu(slate.slate_number, e)}
                      className="p-1 rounded hover:bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-dim)] hover:text-[var(--theme-text)] transition-colors"
                      title={strings.slates.menu.more}
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                        <circle cx="8" cy="2" r="1.5"/>
                        <circle cx="8" cy="8" r="1.5"/>
                        <circle cx="8" cy="14" r="1.5"/>
                      </svg>
                    </button>

                    {openMenuId === slate.slate_number && (
                      <div className="absolute right-0 top-full mt-1 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded shadow-2xl overflow-hidden min-w-[160px] z-10">
                        <button
                          onClick={(e) => togglePin(slate, e)}
                          className="w-full px-4 py-2 text-left hover:bg-[var(--theme-bg-tertiary)] hover:text-[var(--theme-text)] transition-colors text-xs md:text-sm"
                        >
                          {isPinned ? strings.slates.pin.unpin : strings.slates.pin.pin}
                        </button>
                        <button
                          onClick={(e) => openTagsEditor(slate, e)}
                          className="w-full px-4 py-2 text-left hover:bg-[var(--theme-bg-tertiary)] hover:text-[var(--theme-text)] transition-colors text-xs md:text-sm"
                        >
                          {strings.slates.menu.tags}
                        </button>
                        <button
                          onClick={(e) => togglePublish(slate, e)}
                          className="w-full px-4 py-2 text-left hover:bg-[var(--theme-bg-tertiary)] hover:text-[var(--theme-text)] transition-colors text-xs md:text-sm"
                        >
                          {slate.is_published ? strings.slates.menu.makePrivate : strings.slates.menu.makePublic}
                        </button>
                        <button
                          onClick={(e) => {
                            setOpenMenuId(null);
                            showDeleteConfirmation(slate.slate_number, slate.title, e);
                          }}
                          className="w-full px-4 py-2 text-left hover:bg-[var(--theme-bg-tertiary)] text-[var(--theme-red)] transition-colors text-xs md:text-sm"
                        >
                          {strings.slates.menu.delete}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 items-center min-h-[24px]">
                  <span className={`text-xs px-2 py-0.5 rounded border ${status.className}`}>
                    {status.label}
                  </span>
                  {slate.adoption_pending && (
                    <span
                      className="text-xs px-2 py-0.5 rounded border text-[var(--theme-text-secondary)] border-[var(--theme-border)] bg-[var(--theme-bg-tertiary)] animate-pulse"
                      title={strings.slates.status.syncingTitle}
                    >
                      {strings.slates.status.syncing}
                    </span>
                  )}
                  {!!slate.is_collab && (
                    <span className="text-xs px-2 py-0.5 rounded border text-[var(--theme-accent)] border-[var(--theme-border)] bg-[var(--theme-bg-tertiary)]">
                      {strings.collab.badge}
                    </span>
                  )}
                  {slate.source_app_name && (
                    <span
                      className="text-xs px-2 py-0.5 rounded border text-[var(--theme-green)] border-[var(--theme-border)] bg-[var(--theme-bg-tertiary)]"
                      title={strings.slates.status.fromAppTitle.replace('{app}', slate.source_app_name)}
                    >
                      {strings.slates.status.fromApp.replace('{app}', slate.source_app_name)}
                    </span>
                  )}
                  {visibleTags.map(tag => (
                    <button
                      key={tag}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setTagFilter(tag);
                      }}
                      className="text-xs px-2 py-0.5 rounded border border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:border-[var(--theme-text-dim)] hover:bg-[var(--theme-bg-tertiary)] transition-colors"
                      title={tag}
                    >
                      {tag}
                    </button>
                  ))}
                  {remainingTagCount > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded border border-[var(--theme-border)] text-[var(--theme-text-dim)]">
                      +{remainingTagCount}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-[var(--theme-text-dim)]">
                  <div className="flex items-center gap-3">
                    <span>{strings.slates.stats.wordsShort(slate.word_count)}</span>
                    <span>{strings.slates.stats.charsShort(slate.char_count)}</span>
                  </div>
                  <span>{formatDateShort(slate.updated_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Grid View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAndSortedSlates.map((slate) => {
            const isPinned = Boolean(slate.pinned_at);
            const tags = Array.isArray(slate.tags) ? slate.tags : [];
            const visibleTags = tags.slice(0, 3);
            const remainingTagCount = Math.max(0, tags.length - visibleTags.length);

            const status = slate.is_published
              ? { label: strings.slates.status.public, className: 'text-[var(--theme-blue)] border-[var(--theme-border)] bg-[var(--theme-bg-tertiary)]' }
              : slate.published_at
                ? { label: strings.slates.status.wasPublic, className: 'text-[var(--theme-orange)] border-[var(--theme-border)] bg-[var(--theme-bg-tertiary)]' }
                : { label: strings.slates.status.private, className: 'text-[var(--theme-text-muted)] border-[var(--theme-border)] bg-[var(--theme-bg-tertiary)]' };

            return (
              <div
                key={slate.slate_number}
                onClick={() => onSelectSlate(slate)}
                className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] p-4 rounded-lg hover:border-[var(--theme-text-dim)] hover:bg-[var(--theme-bg-tertiary)] transition-all cursor-pointer group flex flex-col min-h-[132px]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isPinned && (
                      <svg className="w-3.5 h-3.5 text-[var(--theme-text-dim)] flex-shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <path d="M10 1.5c0-.3-.2-.5-.5-.5h-3c-.3 0-.5.2-.5.5V6L4 8v1h3v5l1-1 1 1V9h3V8l-2-2V1.5z" />
                      </svg>
                    )}
                    <h3 className="text-[var(--theme-text)] text-sm md:text-base font-medium truncate flex-1">
                      {slate.title || strings.slates.untitled}
                    </h3>
                  </div>

                  <div className="relative flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => toggleMenu(slate.slate_number, e)}
                      className="p-1 rounded hover:bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-dim)] hover:text-[var(--theme-text)] transition-colors"
                      title={strings.slates.menu.more}
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                        <circle cx="8" cy="2" r="1.5"/>
                        <circle cx="8" cy="8" r="1.5"/>
                        <circle cx="8" cy="14" r="1.5"/>
                      </svg>
                    </button>

                    {openMenuId === slate.slate_number && (
                      <div className="absolute right-0 top-full mt-1 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded shadow-2xl overflow-hidden min-w-[160px] z-10">
                        <button
                          onClick={(e) => togglePin(slate, e)}
                          className="w-full px-4 py-2 text-left hover:bg-[var(--theme-bg-tertiary)] hover:text-[var(--theme-text)] transition-colors text-xs md:text-sm"
                        >
                          {isPinned ? strings.slates.pin.unpin : strings.slates.pin.pin}
                        </button>
                        <button
                          onClick={(e) => openTagsEditor(slate, e)}
                          className="w-full px-4 py-2 text-left hover:bg-[var(--theme-bg-tertiary)] hover:text-[var(--theme-text)] transition-colors text-xs md:text-sm"
                        >
                          {strings.slates.menu.tags}
                        </button>
                        <button
                          onClick={(e) => togglePublish(slate, e)}
                          className="w-full px-4 py-2 text-left hover:bg-[var(--theme-bg-tertiary)] hover:text-[var(--theme-text)] transition-colors text-xs md:text-sm"
                        >
                          {slate.is_published ? strings.slates.menu.makePrivate : strings.slates.menu.makePublic}
                        </button>
                        <button
                          onClick={(e) => {
                            setOpenMenuId(null);
                            showDeleteConfirmation(slate.slate_number, slate.title, e);
                          }}
                          className="w-full px-4 py-2 text-left hover:bg-[var(--theme-bg-tertiary)] text-[var(--theme-red)] transition-colors text-xs md:text-sm"
                        >
                          {strings.slates.menu.delete}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 items-center min-h-[24px]">
                  <span className={`text-xs px-2 py-0.5 rounded border ${status.className}`}>
                    {status.label}
                  </span>
                  {slate.adoption_pending && (
                    <span
                      className="text-xs px-2 py-0.5 rounded border text-[var(--theme-text-secondary)] border-[var(--theme-border)] bg-[var(--theme-bg-tertiary)] animate-pulse"
                      title={strings.slates.status.syncingTitle}
                    >
                      {strings.slates.status.syncing}
                    </span>
                  )}
                  {!!slate.is_collab && (
                    <span className="text-xs px-2 py-0.5 rounded border text-[var(--theme-accent)] border-[var(--theme-border)] bg-[var(--theme-bg-tertiary)]">
                      {strings.collab.badge}
                    </span>
                  )}
                  {slate.source_app_name && (
                    <span
                      className="text-xs px-2 py-0.5 rounded border text-[var(--theme-green)] border-[var(--theme-border)] bg-[var(--theme-bg-tertiary)]"
                      title={strings.slates.status.fromAppTitle.replace('{app}', slate.source_app_name)}
                    >
                      {strings.slates.status.fromApp.replace('{app}', slate.source_app_name)}
                    </span>
                  )}
                  {visibleTags.map(tag => (
                    <button
                      key={tag}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setTagFilter(tag);
                      }}
                      className="text-xs px-2 py-0.5 rounded border border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:border-[var(--theme-text-dim)] hover:bg-[var(--theme-bg-tertiary)] transition-colors"
                      title={tag}
                    >
                      {tag}
                    </button>
                  ))}
                  {remainingTagCount > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded border border-[var(--theme-border)] text-[var(--theme-text-dim)]">
                      +{remainingTagCount}
                    </span>
                  )}
                </div>

                <div className="mt-auto pt-3 flex items-center justify-between text-xs text-[var(--theme-text-dim)]">
                  <span>{strings.slates.stats.wordsShort(slate.word_count)}</span>
                  <span>{formatDateShort(slate.updated_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal.show && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-white mb-4">{strings.slates.deleteModal.title}</h2>
            <p className="text-sm text-[#666] mb-6 break-words">
              {strings.slates.deleteModal.message(deleteModal.slateTitle.length > 100 ? deleteModal.slateTitle.substring(0, 100) + '...' : deleteModal.slateTitle)}
            </p>
            <div className="flex gap-3">
              <button
                onClick={confirmDelete}
                className="flex-1 bg-red-600 text-white px-6 py-3 rounded hover:bg-red-700 transition-colors text-sm"
              >
                {strings.slates.deleteModal.confirm}
              </button>
              <button
                onClick={cancelDelete}
                className="flex-1 border border-[#333] text-white px-6 py-3 rounded hover:bg-[#333] transition-colors text-sm"
              >
                {strings.slates.deleteModal.cancel}
              </button>
            </div>
          </div>
        </div>
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
    </div>
  );
}
