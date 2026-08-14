import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { API_URL } from '../config';
import { VERSION } from '../version';
import { strings } from '../strings';
import { builtInThemes, hiddenThemes, getThemeIds, getTheme, isCustomTheme, addCustomTheme, removeCustomTheme, getExampleThemeJson, validateTheme, applyThemeVariables, syncThemeToServer, syncCustomThemesToServer, MAX_CUSTOM_THEMES, getCustomThemeCount } from '../themes';
import { encryptContent, decryptContent, encryptTitle, decryptTitle, reencryptForApp, decryptOwnerGrant, unwrapKey } from '../crypto';
import { getSlateKey } from '../keyStore';
import { CollabShareModal } from './CollabShareModal';
import { fetchSharedSlate } from '../collab';
import { usePresence } from '../presence';
import { withViewTransition } from '../viewTransition';
import { VerifyBadge } from './VerifyBadge';

// Rich (live preview) editor loads on demand so plain-mode writers never pay for it
const TiptapEditor = React.lazy(() => import('./LivePreviewEditor'));
// Collaborative editor (yjs + remote carets) — its own on-demand chunk
const CollabEditorLazy = React.lazy(() => import('./CollabEditor'));
// Version history browser (also carries yjs) — loaded only when opened
const CollabHistoryLazy = React.lazy(() => import('./CollabHistoryModal'));

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

export const Writer = forwardRef(({ token, userId, currentSlate, onSlateChange, onLogin, onZenModeChange, parentZenMode, onOpenAuthModal, sharedSlateId = null }, ref) => {
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('ready');
  const [zenMode, setZenMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingFadeOut, setLoadingFadeOut] = useState(false);
  const [contentFadeKey, setContentFadeKey] = useState(0);
  const [showPublishMenu, setShowPublishMenu] = useState(false);
  const [shareUrl, setShareUrl] = useState(null);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [editorMode, setEditorModeState] = useState('plain'); // 'plain' | 'wysiwyg' — a per-document setting
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishModalUrl, setPublishModalUrl] = useState('');
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
  // Collaborative slate: the doc key the content is encrypted under (null for
  // solo slates). Set on load from the owner's wrapped copy, or by the share
  // modal when sharing is turned on/off.
  const [collabDocKey, setCollabDocKey] = useState(null);
  // Bumped whenever the doc key changes (enable, rotation, rekey) to remount
  // the collab editor, and to re-run the shared load after a rotation.
  const [collabKeyGen, setCollabKeyGen] = useState(0);
  const [collabReloadKey, setCollabReloadKey] = useState(0);
  const [showCollabModal, setShowCollabModal] = useState(false);
  const [showCollabHistory, setShowCollabHistory] = useState(false);
  // Live handle into the collab editor ({ replaceText }) for history restores
  const collabApiRef = useRef(null);
  // Rooms are keyed by the slate's DB id (not the per-user slate_number)
  const [collabSlateDbId, setCollabSlateDbId] = useState(null);
  // Shared mode: this Writer shows a slate someone else owns — same surface,
  // no owner powers (no PUT saves, publish, or member management)
  const isShared = !!sharedSlateId;
  const [sharedBy, setSharedBy] = useState(null);
  const [sharedRemoved, setSharedRemoved] = useState(false);
  // Two-step "unpublish completely": arms sure?, reverts after 3s untouched
  const [confirmForget, setConfirmForget] = useState(false);
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
  const [mobileTab, setMobileTab] = useState('write'); // 'write' | 'settings' | 'more'
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [themeImportError, setThemeImportError] = useState(null);
  const themeFileInputRef = useRef(null);
  const [focusMode, setFocusMode] = useState(() => localStorage.getItem('justtype-focus-mode') || 'auto'); // 'off' | 'on' | 'auto'
  const [showCounter, setShowCounter] = useState(() => localStorage.getItem('justtype-show-counter') !== 'false');
  const autoZenTimeoutRef = useRef(null);
  const autoZenActiveRef = useRef(false);
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('justtype-theme') || 'light';
  });
  const [previewTheme, setPreviewTheme] = useState(null); // For hover preview
  const [punto, setPunto] = useState(localStorage.getItem('justtype-punto') || 'base');
  const [threeDotsTransform, setThreeDotsTransform] = useState(0);
  const textareaRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const saveMenuTimeoutRef = useRef(null);
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
      setIsLoading(true);
      loadSlate(currentSlate.slate_number);
    } else if (!currentSlate && !content.trim()) {
      // Only clear content if there's no current slate AND no content
      // This prevents clearing user's work when they log in after writing
      setContent('');
      setTitle('');
      setHasUnsavedChanges(false);
      setWasPublishedBeforeEdit(false);
      lastSavedContentRef.current = '';
      setIsLoading(false);
    }
  }, [currentSlate, token]);

  // Autofocus textarea on blank slate (so user can "just type")
  useEffect(() => {
    if (!currentSlate && !isLoading && textareaRef.current) {
      textareaRef.current.focus();
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

  // Save punto to localStorage
  useEffect(() => {
    localStorage.setItem('justtype-punto', punto);
  }, [punto]);

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
      setIsMenuClosing(false);
    }, 500); // Match the animation duration
  };

  const handleToggleMenu = () => {
    if (showSettingsMenu) {
      handleCloseMenu();
      setShowMenuButton(false);
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

  // Auto-save
  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      if (hasUnsavedChanges && content) {
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
  }, [content, hasUnsavedChanges, token, currentSlate]);

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
          saveSlate();
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

  const loadSlate = async (id) => {
    try {
      const response = await fetch(`${API_URL}/slates/${id}`, {
        credentials: 'include'
      });

      // Check if encryption key is missing (server restarted)
      if (response.status === 401) {
        const data = await response.json();
        if (data.code === 'ENCRYPTION_KEY_MISSING') {
          setIsLoading(false);
          onLogin();
          return;
        }
      }

      const data = await response.json();
      let slateContent;
      let slateTitle = data.title;
      let slateKey = null;
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
        if (data.is_collab && data.collab_wrapped_key) {
          contentKey = await unwrapKey(data.collab_wrapped_key, slateKey);
          slateContent = await decryptContent(data.encryptedContent, contentKey);
          loadedContentRef.current = slateContent;
          setCollabDocKey(contentKey);
          setCollabSlateDbId(data.id);
        } else {
          setCollabDocKey(null);
          setCollabSlateDbId(null);
          slateContent = await decryptContent(data.encryptedContent, contentKey);
        }
        // Decrypt title if encrypted
        if (data.encrypted_title && !data.is_published) {
          try {
            slateTitle = await decryptTitle(data.encrypted_title, contentKey);
          } catch (err) {
            console.error('Failed to decrypt title:', err);
            slateTitle = 'untitled slate';
          }
        }
      } else {
        slateContent = data.content;
        setCollabDocKey(null);
      }

      // Two-way sync: adopt any newer edit a connected app made to this slate.
      // (Collab slates are never app-shared — enforced server-side.)
      if (data.encrypted && slateKey && !data.is_published && !data.is_collab) {
        const merged = await pullAppEdits(id, slateKey);
        if (merged) {
          slateContent = merged.content;
          if (merged.title != null && merged.title.trim()) slateTitle = merged.title;
        }
      }

      setTitle(slateTitle);
      setContent(slateContent);
      setEditorModeState(data.editor_mode === 'wysiwyg' ? 'wysiwyg' : 'plain');
      setShareUrl(data.is_published ? `${window.location.origin}/s/${data.share_id}` : null);
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

  const saveSlateSync = async () => {
    if (isShared) return; // shared slates persist through the collab relay
    if (!title.trim() || !token || !currentSlate) return;

    setStatus('saving...');

    try {
      const firstLine = content.split('\n')[0].trim().replace(/^#{1,6}\s+/, '');
      const titleToSave = firstLine || 'untitled slate';

      // Try E2E encryption (collab slates encrypt under the shared doc key)
      const slateKey = userId ? await getSlateKey(userId) : null;
      const contentKey = collabDocKey || slateKey;
      let body;
      if (contentKey) {
        const encrypted = await encryptContent(content, contentKey);
        const encryptedTitleBlob = await encryptTitle(titleToSave, contentKey);
        const wordCount = content.trim() === '' ? 0 : content.trim().split(/\s+/).length;
        const charCount = content.length;
        const sizeBytes = new TextEncoder().encode(content).length;
        // ZK titles: do not send plaintext titles to the server for E2E slates.
        body = { encryptedTitle: encryptedTitleBlob, encryptedContent: encrypted, wordCount, charCount, sizeBytes };
      } else {
        body = { title: titleToSave, content };
      }

      const response = await fetch(`${API_URL}/slates/${currentSlate.slate_number}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      // Check if encryption key is missing (server restarted)
      if (response.status === 401) {
        const data = await response.json();
        if (data.code === 'ENCRYPTION_KEY_MISSING') {
          setStatus(strings.errors.sessionExpired);
          onLogin();
          return;
        }
      }

      if (response.ok) {
        lastSavedContentRef.current = JSON.stringify({ content });
        setHasUnsavedChanges(false);
        setStatus('saved');
        setTimeout(() => setStatus('ready'), 2000);
      }
    } catch (err) {
      console.error('Save failed:', err);
    }
  };

  // Expose save function to parent via ref
  useImperativeHandle(ref, () => ({
    saveBeforeNavigate: async () => {
      if (hasUnsavedChanges && content.trim() && token && currentSlate) {
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
      setShowCollabModal(false);
    },
    // Command palette methods
    saveSlate: () => saveSlate(),
    toggleEditorMode: () => toggleEditorMode(),
    openPublishMenu: () => setShowPublishMenu(true),
    exportAs: (format) => {
      switch (format) {
        case 'txt': exportToTxt(); break;
        case 'md': exportToMarkdown(); break;
        case 'pdf': exportToPdf(); break;
        case 'html': exportToHtml(); break;
      }
    },
    setTheme: (themeId) => setTheme(themeId),
    setFocusMode: (mode) => setFocusMode(mode)
  }));

  const saveSlate = async () => {
    if (isShared) return null; // shared slates persist through the collab relay
    // Extract title from first line of content
    const firstLine = content.split('\n')[0].trim().replace(/^#{1,6}\s+/, '');
    const titleToSave = firstLine || 'untitled slate';

    if (!content.trim()) return null;

    setStatus('saving...');

    try {
      const method = currentSlate ? 'PUT' : 'POST';
      const url = currentSlate
        ? `${API_URL}/slates/${currentSlate.slate_number}`
        : `${API_URL}/slates`;

      // Try E2E encryption (collab slates encrypt under the shared doc key;
      // new slates are never collab)
      const slateKey = userId ? await getSlateKey(userId) : null;
      const contentKey = currentSlate ? (collabDocKey || slateKey) : slateKey;
      let body;
      if (contentKey) {
        const encrypted = await encryptContent(content, contentKey);
        const encryptedTitleBlob = await encryptTitle(titleToSave, contentKey);
        const wordCount = content.trim() === '' ? 0 : content.trim().split(/\s+/).length;
        const charCount = content.length;
        const sizeBytes = new TextEncoder().encode(content).length;
        // ZK titles: do not send plaintext titles to the server for E2E slates.
        body = { encryptedTitle: encryptedTitleBlob, encryptedContent: encrypted, wordCount, charCount, sizeBytes };
      } else {
        body = { title: titleToSave, content };
      }

      // New slates carry their editor mode; existing slates persist it via metadata PATCH
      if (!currentSlate) {
        body.editorMode = editorMode;
      }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      // Check if encryption key is missing (server restarted)
      if (response.status === 401) {
        const data = await response.json();
        if (data.code === 'ENCRYPTION_KEY_MISSING') {
          setStatus(strings.errors.sessionExpired);
          onLogin();
          return null;
        }
      }

      if (!response.ok) {
        setStatus(strings.errors.saveFailed);
        return null;
      }

      const data = await response.json();

      if (!currentSlate) {
        onSlateChange(data);
      }

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

      // Handle unpublishing due to edit
      if (data.was_unpublished) {
        setShareUrl(null);
        setWasPublishedBeforeEdit(true);
        setStatus(strings.writer.status.savedAsPrivate);
        setTimeout(() => setStatus(strings.writer.status.privateDraft), 3000);
      } else if (data.is_published && data.share_id) {
        // System slates that stay published
        setShareUrl(`${window.location.origin}/s/${data.share_id}`);
        setStatus('saved');
        setTimeout(() => setStatus(strings.writer.status.published), 2000);
      } else {
        setStatus('saved');
        setTimeout(() => setStatus('ready'), 2000);
      }

      return data; // Return the saved slate data
    } catch (err) {
      setStatus(strings.errors.saveFailed);
      console.error('Save failed:', err);
      return null;
    }
  };

  const handlePublish = async () => {
    if (!token) {
      onLogin();
      return;
    }

    // If no current slate, save first
    // If there are unsaved changes, save first (but keep using currentSlate for the ID)
    if (!currentSlate) {
      setStatus('saving...');
      const savedSlate = await saveSlate();
      if (!savedSlate) {
        // Error status already set by saveSlate
        return;
      }
      // savedSlate has the full data including id when creating a new slate
      // Now currentSlate will be set by onSlateChange, but we can't rely on it yet
      // We need to wait for the next render, so just return and let user click again
      // Actually, let's just proceed since onSlateChange was called
      // But actually the issue is onSlateChange happens in saveSlate at line 469
      // which updates the parent state, but we're still in this execution context
      // So currentSlate is still null here. We should not try to publish yet.
      setStatus('slate saved! click publish again to publish it.');
      setTimeout(() => setStatus('ready'), 3000);
      return;
    }

    if (hasUnsavedChanges) {
      setStatus('saving...');
      const savedSlate = await saveSlate();
      if (!savedSlate) {
        // Error status already set by saveSlate
        return;
      }
      // Keep using currentSlate which has the id
    }

    // Detect if this is a first publish or republish
    const isFirstPublish = !wasPublishedBeforeEdit && !shareUrl;
    const isRepublish = wasPublishedBeforeEdit && !shareUrl;

    try {
      // For E2E users publishing, send plaintext content and title for the public copy
      // For unpublishing, send encrypted title to re-encrypt it
      const publishBody = { isPublished: !shareUrl };
      const slateKey = userId ? await getSlateKey(userId) : null;

      if (!shareUrl) {
        // Publishing — include plaintext for public copy (E2E users need this)
        if (slateKey) {
          publishBody.publicContent = content;
          // Send plaintext title for public view
          const firstLine = content.split('\n')[0].trim().replace(/^#{1,6}\s+/, '');
          publishBody.publicTitle = firstLine || 'untitled slate';
        }
      } else {
        // Unpublishing — encrypt title for private storage (collab slates
        // keep their titles under the shared doc key)
        if (slateKey) {
          const firstLine = content.split('\n')[0].trim().replace(/^#{1,6}\s+/, '');
          const titleToEncrypt = firstLine || 'untitled slate';
          publishBody.encryptedTitle = await encryptTitle(titleToEncrypt, collabDocKey || slateKey);
        }
      }

      const response = await fetch(`${API_URL}/slates/${currentSlate.slate_number}/publish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(publishBody),
      });

      const data = await response.json();

      if (response.ok) {
        if (data.share_url) {
          setShareUrl(data.share_url);
          setWasPublishedBeforeEdit(false); // Reset since we're now published

          if (isFirstPublish) {
            // First publish: Show modal with link
            setPublishModalUrl(data.share_url);
            setShowPublishModal(true);
          } else if (isRepublish) {
            // Republish: Just show status, no modal, no auto-copy
            setStatus(strings.writer.status.republished);
            setTimeout(() => setStatus('ready'), 2000);
          } else {
            // Already published, user clicked "unpublish" then "get shareable link" again
            // This shouldn't happen with current UI, but handle it as first publish
            setPublishModalUrl(data.share_url);
            setShowPublishModal(true);
          }
        } else {
          // Unpublishing
          setShareUrl(null);
          setWasPublishedBeforeEdit(false);
          setStatus(strings.writer.status.unpublished);
          setTimeout(() => setStatus('ready'), 2000);
        }
      } else {
        setStatus('publish failed');
        setTimeout(() => setStatus('ready'), 2000);
      }

      setShowPublishMenu(false);
    } catch (err) {
      console.error('Publish failed:', err);
      setStatus('publish failed');
      setTimeout(() => setStatus('ready'), 2000);
    }
  };

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
    const blob = new Blob([content], { type: 'text/markdown' });
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

  const exportToPdf = () => {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title || 'Slate'}</title>
          <style>
            body {
              font-family: 'IBM Plex Mono', monospace;
              padding: 40px;
              max-width: 800px;
              margin: 0 auto;
              line-height: 1.6;
              color: #333;
            }
            h1 { margin-bottom: 20px; }
            pre {
              white-space: pre-wrap;
              word-wrap: break-word;
            }
          </style>
        </head>
        <body>
          <h1>${title || 'Untitled Slate'}</h1>
          <pre>${content}</pre>
        </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
    setShowSaveMenu(false);
  };

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

  const cycleTheme = () => {
    const themes = getThemeIds();
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
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

  const handleDeleteTheme = (themeId) => {
    const result = removeCustomTheme(themeId);
    if (result.success) {
      if (theme === themeId) {
        setTheme('dark');
        if (token) syncThemeToServer('dark');
      }
      // Sync custom themes to server
      if (token) syncCustomThemesToServer();
    }
  };

  const cyclePunto = () => {
    const sizes = ['small', 'base', 'large'];
    const currentIndex = sizes.indexOf(punto);
    const nextIndex = (currentIndex + 1) % sizes.length;
    setPunto(sizes[nextIndex]);
  };

  const getPuntoLabel = () => {
    switch (punto) {
      case 'small': return 'Aa−';
      case 'large': return 'Aa+';
      default: return 'Aa';
    }
  };

  const cycleFocus = () => {
    const modes = ['off', 'on', 'auto'];
    const currentIndex = modes.indexOf(focusMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setFocusMode(modes[nextIndex]);
  };

  const getFocusLabel = () => {
    switch (focusMode) {
      case 'on': return 'focus';
      case 'auto': return 'smart focus';
      default: return 'focus off';
    }
  };

  const getCounterLabel = () => {
    return showCounter ? 'hide counter' : 'show counter';
  };

  return (
    <div className="relative flex flex-col bg-[var(--theme-bg)] h-full overflow-hidden">
      {/* LOADING OVERLAY */}
      {isLoading && (
        <div className={`absolute inset-0 bg-[var(--theme-bg)] flex items-center justify-center z-50 transition-opacity duration-300 ${loadingFadeOut ? 'opacity-0' : 'animate-[fadeInUp_0.2s_ease-out]'}`}>
          <div className="text-[var(--theme-text-dim)] text-sm animate-pulse">loading slate...</div>
        </div>
      )}

      {/* WRITING AREA */}
      <main key={contentFadeKey} className={`flex-grow flex justify-center w-full bg-[var(--theme-bg)] overflow-y-auto ${contentFadeKey > 0 ? 'animate-[fadeInUp_0.3s_ease-out]' : ''}`}>
        {collabDocKey && collabSlateDbId ? (
          // Collaborative slate: one live CM6 surface for BOTH modes (remote
          // carets need it); `editorMode` only toggles the live preview.
          <React.Suspense
            fallback={
              <div className="w-full max-w-3xl p-8 text-sm animate-pulse" style={{ color: 'var(--theme-text-dim)' }}>
                {strings.writer.editorMode.loading}
              </div>
            }
          >
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
          <React.Suspense
            fallback={
              <div className="w-full max-w-3xl p-8 text-sm animate-pulse" style={{ color: 'var(--theme-text-dim)' }}>
                {strings.writer.editorMode.loading}
              </div>
            }
          >
            <TiptapEditor
              content={content}
              onChange={setContent}
              puntoClass={`punto-${punto}`}
            />
          </React.Suspense>
        ) : (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder={strings.writer.contentPlaceholder}
            spellCheck={false}
            className={`w-full max-w-3xl bg-[var(--theme-bg)] border-none leading-relaxed resize-none p-8 focus:ring-0 placeholder-[var(--theme-text-dim)] text-[var(--theme-text)] punto-${punto}`}
          />
        )}
      </main>

      {/* DESKTOP FOOTER */}
      <footer className={`hidden md:block px-8 py-4 border-t border-transparent bg-[var(--theme-bg)] transition-opacity duration-500 ${zenMode ? 'opacity-0 hover:opacity-100' : 'opacity-100'} relative`}>
        <div className="flex justify-between items-center gap-4 text-sm">

          {/* Left Controls */}
          <div className="flex items-center gap-6 min-h-[32px] relative flex-1 min-w-0" ref={settingsMenuRef}>
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
              <div
                ref={stripRef}
                className={`settings-strip absolute left-12 right-0 overflow-x-auto flex items-center gap-2 transition-opacity duration-500 ${stripFade.l ? 'strip-fade-l' : ''} ${stripFade.r ? 'strip-fade-r' : ''} ${isMenuClosing ? 'opacity-0' : 'animate-[fadeInFromLeft_0.4s_ease-out_both]'}`}
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
                <div className="relative" data-theme-picker>
                  <button
                    onClick={(e) => { anchorPopover(e); toggleTheme(); }}
                    className="transition-colors duration-200 hover:opacity-70 text-sm whitespace-nowrap"
                    style={{ color: 'var(--theme-accent)' }}
                  >
                    theme: {theme}
                  </button>
                  {showThemePicker && popoverAnchor && (
                    <div
                      className="fixed rounded shadow-2xl overflow-hidden min-w-[160px] animate-[fadeInUp_0.15s_ease-out]"
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
                      {/* Custom themes */}
                      {getThemeIds().filter(id => isCustomTheme(id)).length > 0 && (
                        <>
                          <div style={{ borderTop: '1px solid var(--theme-border)', margin: '4px 0' }} />
                          {getThemeIds().filter(id => isCustomTheme(id)).map(themeId => (
                            <div key={themeId} className="flex items-center">
                              <button
                                onClick={() => selectTheme(themeId)}
                                onMouseEnter={() => setPreviewTheme(themeId)}
                                className="flex-1 px-4 py-2 text-left transition-colors duration-200 text-sm"
                                style={{
                                  color: theme === themeId ? 'var(--theme-accent)' : 'var(--theme-text-muted)',
                                  backgroundColor: 'transparent'
                                }}
                                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--theme-bg-tertiary)'}
                                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                {themeId}
                              </button>
                              <button
                                onClick={() => handleDeleteTheme(themeId)}
                                onMouseEnter={() => setPreviewTheme(themeId)}
                                className="px-3 py-2 transition-colors duration-200 text-sm"
                                style={{ color: 'var(--theme-text-dim)' }}
                                onMouseOver={(e) => { e.currentTarget.style.color = 'var(--theme-red)'; e.currentTarget.style.backgroundColor = 'var(--theme-bg-tertiary)'; }}
                                onMouseOut={(e) => { e.currentTarget.style.color = 'var(--theme-text-dim)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                                title="delete theme"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </>
                      )}
                      {/* Import/Download buttons */}
                      <div style={{ borderTop: '1px solid var(--theme-border)', margin: '4px 0' }} />
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
                  )}
                </div>
                <span className="opacity-30">·</span>
                <button
                  onClick={cyclePunto}
                  className="transition-colors duration-200 hover:opacity-70 text-sm whitespace-nowrap"
                  style={{ color: 'var(--theme-accent)' }}
                >
                  {getPuntoLabel()}
                </button>
                <span className="opacity-30">·</span>
                <button
                  onClick={cycleFocus}
                  className="transition-colors duration-200 hover:opacity-70 text-sm whitespace-nowrap"
                  style={{ color: 'var(--theme-accent)' }}
                >
                  {getFocusLabel()}
                </button>
                <span className="opacity-30">·</span>
                <button
                  onClick={() => setShowCounter(!showCounter)}
                  className="transition-colors duration-200 hover:opacity-70 text-sm whitespace-nowrap"
                  style={{ color: 'var(--theme-accent)' }}
                >
                  {getCounterLabel()}
                </button>
                <span className="opacity-30">·</span>
                <button
                  onClick={toggleEditorMode}
                  className="transition-colors duration-200 hover:opacity-70 text-sm whitespace-nowrap"
                  style={{ color: 'var(--theme-accent)' }}
                >
                  {strings.writer.editorMode.label(editorMode)}
                </button>
                {token && (currentSlate || isShared) && (
                  <>
                    <span className="opacity-30">·</span>
                    <button
                      onClick={() => setShowCollabModal(true)}
                      className="transition-colors duration-200 hover:opacity-70 text-sm whitespace-nowrap"
                      style={{ color: 'var(--theme-accent)' }}
                    >
                      {strings.collab.menuButton}
                    </button>
                  </>
                )}
                {token && !isShared && (
                  <>
                    <span className="opacity-30">·</span>
                    <div className="relative">
                      <button
                        onClick={(e) => { anchorPopover(e); setShowPublishMenu(!showPublishMenu); }}
                        className="transition-colors duration-200 hover:opacity-70 text-sm whitespace-nowrap"
                        style={{ color: 'var(--theme-accent)' }}
                      >
                        share
                      </button>
                      {showPublishMenu && popoverAnchor && (
                        <div
                          className="fixed bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded shadow-2xl overflow-hidden min-w-[160px] animate-[fadeInUp_0.15s_ease-out]"
                          style={{ left: popoverAnchor.left, bottom: popoverAnchor.bottom, zIndex: 200 }}
                        >
                          {!shareUrl && !wasPublishedBeforeEdit && (
                            <button
                              onClick={handlePublish}
                              className="w-full px-4 py-2 text-left hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-colors duration-200"
                            >
                              make public
                            </button>
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
                      )}
                    </div>
                  </>
                )}
              </div>
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
              <div className={`flex gap-4 ml-2 transition-opacity duration-500 ${showSettingsMenu && !isMenuClosing ? 'opacity-0' : 'opacity-50'}`}>
                <span>{strings.writer.stats.words(wordCount)}</span>
                <span>{strings.writer.stats.chars(charCount)}</span>
              </div>
            )}
          </div>

          {/* Right Controls */}
          <div className="flex gap-4 items-center">
            <span
              className={`transition-opacity duration-300 ${
                status === 'ready' ? 'opacity-0' : 'opacity-100'
              } ${
                status === strings.writer.status.privateDraft || status === strings.writer.status.savedAsPrivate ? 'text-orange-400' :
                status === 'saved' ? 'text-green-500' :
                'text-green-500'
              } ${
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
              {status}
            </span>

            {status !== 'ready' && <span className="opacity-30">·</span>}

            <button
              onClick={() => setShowAboutModal(true)}
              className="hover:text-white transition-colors duration-200"
            >
              {strings.writer.buttons.about}
            </button>

            {token && (
              <div className="relative flex items-center gap-3">
                {/* One compact publish indicator: blue when the public copy is
                    current, orange and clickable when it needs a sync */}
                {shareUrl && !wasPublishedBeforeEdit && (
                  <span className="text-sm text-blue-400">{strings.writer.publicState.current}</span>
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

                {/* Shared slate: who owns it, and whether we lost access */}
                {isShared && sharedBy && !sharedRemoved && (
                  <span className="text-sm text-[var(--theme-text-dim)]">
                    {strings.collab.viewer.sharedBy(sharedBy)}
                  </span>
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
                    setStatus('saved');
                    setTimeout(() => setStatus('ready'), 2000);
                    return;
                  }
                  saveSlate();
                }}
                className="hover:text-white transition-all duration-300 active:scale-95 flex items-center gap-2"
              >
                <span>[{isShared ? 'export' : strings.writer.buttons.save}]</span>
                {token && !isShared && <span className="text-xs opacity-50">⌘S</span>}
              </button>
              {showSaveMenu && (
                <div
                  onMouseEnter={handleSaveMenuEnter}
                  onMouseLeave={handleSaveMenuLeave}
                  className="absolute bottom-full right-0 mb-2 animate-[fadeInUp_0.15s_ease-out]"
                >
                  <button
                    onClick={() => setShowExportMenu(true)}
                    className="px-3 py-1.5 hover:text-white transition-colors duration-200 flex items-center gap-3 whitespace-nowrap"
                  >
                    <span>export</span>
                    <span className="text-xs opacity-50">⌘E</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </footer>

      {/* MOBILE FLOATING MENU BUTTON */}
      <button
        onClick={() => setShowMobileMenu(!showMobileMenu)}
        className="md:hidden fixed bottom-6 right-6 w-14 h-14 bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border)] rounded-full flex items-center justify-center hover:bg-[var(--theme-bg-tertiary)] transition-all duration-300 shadow-2xl z-50"
      >
        <svg className="w-6 h-6 text-[var(--theme-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
      </button>

      {/* MOBILE BOTTOM SHEET - Tabbed Design */}
      {showMobileMenu && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
            onClick={() => setShowMobileMenu(false)}
          />
          <div className="md:hidden fixed bottom-0 left-0 right-0 bg-[var(--theme-bg-secondary)] border-t border-[var(--theme-border)] rounded-t-2xl z-50 max-h-[60vh] flex flex-col">
            {/* Tab Bar */}
            <div className="flex border-b border-[var(--theme-border)] px-2 pt-3">
              {['write', 'settings', 'more'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setMobileTab(tab)}
                  className={`flex-1 py-2 text-sm transition-colors ${
                    mobileTab === tab
                      ? 'text-white border-b-2 border-white -mb-[1px]'
                      : 'text-[var(--theme-text-dim)]'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {/* Write Tab */}
              {mobileTab === 'write' && (
                <div className="flex flex-col gap-4">
                  {/* Stats */}
                  {showCounter && (
                    <div className="flex gap-4 text-sm">
                      <div className="flex-1 p-3 bg-[var(--theme-bg-tertiary)] rounded-lg text-center">
                        <div className="text-xl font-medium text-white">{wordCount}</div>
                        <div className="text-xs text-[var(--theme-text-dim)]">words</div>
                      </div>
                      <div className="flex-1 p-3 bg-[var(--theme-bg-tertiary)] rounded-lg text-center">
                        <div className="text-xl font-medium text-white">{charCount}</div>
                        <div className="text-xs text-[var(--theme-text-dim)]">chars</div>
                      </div>
                    </div>
                  )}

                  {/* Status */}
                  {status !== 'ready' && (
                    <div className={`p-3 rounded-lg text-center text-sm ${
                      status === strings.writer.status.privateDraft || status === strings.writer.status.savedAsPrivate
                        ? 'text-orange-400'
                        : 'text-green-500'
                    }`}>
                      {status}
                    </div>
                  )}

                  {/* Save Button */}
                  <button
                    onClick={() => {
                      if (!token) {
                        onLogin();
                        setShowMobileMenu(false);
                        return;
                      }
                      if (!hasUnsavedChanges && currentSlate) {
                        setStatus('saved');
                        setTimeout(() => setStatus('ready'), 2000);
                        return;
                      }
                      saveSlate();
                    }}
                    className="p-4 bg-white text-black rounded-lg hover:bg-[#e5e5e5] transition-colors font-medium"
                  >
                    {strings.writer.buttons.save}
                  </button>

                  {/* Share section (owner only — shared slates publish via their owner) */}
                  {token && !isShared && (
                    <div className="flex flex-col gap-2">
                      {/* Status indicator */}
                      {(shareUrl || wasPublishedBeforeEdit) && (
                        <div className={`text-sm text-center py-2 ${wasPublishedBeforeEdit ? 'text-orange-400' : 'text-blue-400'}`}>
                          public{wasPublishedBeforeEdit ? ' · outdated' : ''}
                        </div>
                      )}

                      <div className="flex gap-2">
                        {/* Sync button when needed */}
                        {wasPublishedBeforeEdit && (
                          <button
                            onClick={handlePublish}
                            className="flex-1 p-3 bg-orange-900/30 text-orange-400 rounded-lg hover:bg-orange-900/50 transition-colors"
                          >
                            sync
                          </button>
                        )}

                        {/* Share/Copy/Make Private */}
                        {!shareUrl && !wasPublishedBeforeEdit && (
                          <button
                            onClick={handlePublish}
                            className="flex-1 p-3 bg-[var(--theme-bg-tertiary)] rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors"
                          >
                            make public
                          </button>
                        )}
                        {shareUrl && (
                          <>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(shareUrl);
                                setStatus(strings.writer.status.linkCopied);
                                setTimeout(() => setStatus('ready'), 2000);
                              }}
                              className="flex-1 p-3 bg-[var(--theme-bg-tertiary)] rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors"
                            >
                              copy link
                            </button>
                            <button
                              onClick={handlePublish}
                              className="p-3 bg-[var(--theme-bg-tertiary)] text-red-400 rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors"
                            >
                              private
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Settings Tab */}
              {mobileTab === 'settings' && (
                <div className="flex flex-col gap-3">
                  <button
                    onClick={cycleTheme}
                    className="w-full p-4 bg-[var(--theme-bg-tertiary)] rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors text-left flex justify-between"
                  >
                    <span>theme</span>
                    <span className="text-[var(--theme-text-dim)]">{theme}</span>
                  </button>
                  <button
                    onClick={cyclePunto}
                    className="w-full p-4 bg-[var(--theme-bg-tertiary)] rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors text-left flex justify-between"
                  >
                    <span>font size</span>
                    <span className="text-[var(--theme-text-dim)]">{getPuntoLabel()}</span>
                  </button>
                  <button
                    onClick={cycleFocus}
                    className="w-full p-4 bg-[var(--theme-bg-tertiary)] rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors text-left flex justify-between"
                  >
                    <span>focus mode</span>
                    <span className="text-[var(--theme-text-dim)]">{getFocusLabel()}</span>
                  </button>
                  <button
                    onClick={() => setShowCounter(!showCounter)}
                    className="w-full p-4 bg-[var(--theme-bg-tertiary)] rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors text-left flex justify-between"
                  >
                    <span>counter</span>
                    <span className="text-[var(--theme-text-dim)]">{showCounter ? 'on' : 'off'}</span>
                  </button>
                  <button
                    onClick={toggleEditorMode}
                    className="w-full p-4 bg-[var(--theme-bg-tertiary)] rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors text-left flex justify-between"
                  >
                    <span>{strings.writer.editorMode.menuTitle}</span>
                    <span className="text-[var(--theme-text-dim)]">{strings.writer.editorMode.value(editorMode)}</span>
                  </button>
                  {token && (currentSlate || isShared) && (
                    <button
                      onClick={() => {
                        setShowMobileMenu(false);
                        setShowCollabModal(true);
                      }}
                      className="w-full p-4 bg-[var(--theme-bg-tertiary)] rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors text-left flex justify-between"
                    >
                      <span>{strings.collab.menuButton}</span>
                      <span className="text-[var(--theme-text-dim)]">{collabDocKey ? 'on' : 'off'}</span>
                    </button>
                  )}
                </div>
              )}

              {/* More Tab */}
              {mobileTab === 'more' && (
                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => {
                      setShowMobileMenu(false);
                      setShowExportMenu(true);
                    }}
                    className="w-full p-4 bg-[var(--theme-bg-tertiary)] rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors text-left"
                  >
                    export slate
                  </button>
                  <button
                    onClick={() => {
                      setShowAboutModal(true);
                      setShowMobileMenu(false);
                    }}
                    className="w-full p-4 bg-[var(--theme-bg-tertiary)] rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors text-left"
                  >
                    about justtype
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* COLLAB SHARE MODAL */}
      {showCollabModal && (currentSlate || isShared) && (
        <CollabShareModal
          slateNumber={currentSlate ? currentSlate.slate_number : null}
          userId={userId}
          username={localStorage.getItem('justtype-username')}
          docKey={collabDocKey}
          memberView={isShared}
          sharedSlateId={sharedSlateId}
          onLeave={() => {
            setShowCollabModal(false);
            window.history.pushState({}, '', '/slates');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          getCurrent={() => ({
            content,
            title: (content.split('\n')[0].trim().replace(/^#{1,6}\s+/, '') || 'untitled slate')
          })}
          onDocKeyChange={(key, slateDbId) => {
            loadedContentRef.current = content;
            setCollabDocKey(key);
            setCollabKeyGen((g) => g + 1);
            // undefined = key rotation, same slate; null = collab disabled
            setCollabSlateDbId((prev) => (slateDbId === undefined ? prev : slateDbId));
          }}
          onOpenHistory={collabDocKey && collabSlateDbId ? () => {
            setShowCollabModal(false);
            setShowCollabHistory(true);
          } : null}
          onClose={() => setShowCollabModal(false)}
        />
      )}

      {/* COLLAB VERSION HISTORY */}
      {showCollabHistory && collabDocKey && collabSlateDbId && (
        <React.Suspense fallback={null}>
          <CollabHistoryLazy
            slateId={collabSlateDbId}
            docKey={collabDocKey}
            onRestore={(text) => {
              if (collabApiRef.current) collabApiRef.current.replaceText(text);
            }}
            onClose={() => setShowCollabHistory(false)}
          />
        </React.Suspense>
      )}

      {/* ABOUT MODAL */}
      {showAboutModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md flex items-center justify-center z-50 p-4 overflow-y-auto animate-modal-overlay" onClick={() => withViewTransition(() => setShowAboutModal(false))}>
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded p-6 md:p-8 max-w-md w-full my-4 animate-modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg md:text-xl text-white mb-6">{strings.writer.about.title}</h2>
            <div className="space-y-4 text-sm text-[var(--theme-text-muted)]">
              <p>{strings.writer.about.description}</p>
              <p className="text-xs">{strings.writer.about.encryption}</p>
              <p className="text-xs">
                read our <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-white hover:underline transition-colors">{strings.writer.about.links.terms}</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-white hover:underline transition-colors">{strings.writer.about.links.privacy}</a>, or learn more about the <a href="/project" target="_blank" rel="noopener noreferrer" className="text-white hover:underline transition-colors">{strings.writer.about.links.project}</a> on <a href="https://github.com/alfaoz/justtype" target="_blank" rel="noopener noreferrer" className="text-white hover:underline transition-colors">github</a>. got thoughts? <button onClick={() => { setShowAboutModal(false); window.history.pushState({}, '', '/feedback'); window.dispatchEvent(new PopStateEvent('popstate')); }} className="text-white hover:underline transition-colors">send us feedback</button>.
              </p>
              <p className="text-xs">
                by <a href="https://alfaoz.dev" target="_blank" rel="noopener noreferrer" className="text-white hover:underline transition-colors">alfaoz</a>
              </p>

              {/* Support Section - Subtle */}
              <div className="pt-4 border-t border-[var(--theme-border)]">
                <p className="text-xs text-[var(--theme-text-dim)] mb-3">
                  justtype is free to use, but unfortunately it's not free to run. if you'd like to support development and help keep justtype running, as well as increase your storage{' '}
                  <a
                    href="/limits"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white hover:underline transition-colors"
                  >
                    limits
                  </a>
                  , you can{' '}
                  <button
                    onClick={() => {
                      setShowAboutModal(false);
                      setShowDonateModal(true);
                    }}
                    className="text-white hover:underline transition-colors"
                  >
                    donate once
                  </button>
                  {' '}(any amount) or{' '}
                  <button
                    onClick={async () => {
                      if (!token) {
                        setShowAboutModal(false);
                        onOpenAuthModal();
                      } else {
                        // Check if already subscribed
                        try {
                          const response = await fetch(`${API_URL}/account/storage`, {
                            credentials: 'include'
                          });
                          const data = await response.json();
                          if (response.ok && data.supporterTier === 'quarterly') {
                            setShowAboutModal(false);
                            setShowAlreadySubscribedModal(true);
                          } else {
                            handleStripeCheckout('quarterly');
                          }
                        } catch (err) {
                          console.error('Failed to check subscription:', err);
                          handleStripeCheckout('quarterly');
                        }
                      }
                    }}
                    className="text-white hover:underline transition-colors"
                  >
                    subscribe
                  </button>
                  {' '}(7 eur / 3 months).
                </p>
              </div>

              <p className="text-xs text-[var(--theme-text-dim)] pt-2 border-t border-[var(--theme-border)]">
                {strings.writer.about.version(VERSION)}
                <span className="mx-1">·</span>
                <VerifyBadge className="text-[var(--theme-text-dim)]">verify</VerifyBadge>
                <span className="mx-1">·</span>
                <a href="/status" className="text-[var(--theme-text-dim)] hover:text-white hover:underline transition-colors">status</a>
                <span className="mx-1">·</span>
                <a href="/dev" className="text-[var(--theme-text-dim)] hover:text-white hover:underline transition-colors">developers</a>
              </p>
            </div>
            <button
              onClick={() => withViewTransition(() => setShowAboutModal(false))}
              className="mt-6 w-full border border-[var(--theme-border)] py-2 md:py-3 rounded hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-all text-sm"
            >
              {strings.writer.about.close}
            </button>
          </div>
        </div>
      )}

      {/* PUBLISH MODAL */}
      {showPublishModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4" onClick={() => withViewTransition(() => {
          setShowPublishModal(false);
          setLinkCopied(false);
        })}>
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded animate-modal-content p-6 md:p-8 max-w-md w-full" onClick={e => e.stopPropagation()}>
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
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4" onClick={() => withViewTransition(() => setShowDonateModal(false))}>
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded animate-modal-content p-6 md:p-8 max-w-md w-full" onClick={e => e.stopPropagation()}>
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
      {showAlreadySubscribedModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4" onClick={() => withViewTransition(() => setShowAlreadySubscribedModal(false))}>
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded animate-modal-content p-6 md:p-8 max-w-md w-full" onClick={e => e.stopPropagation()}>
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
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4" onClick={() => setShowExportMenu(false)}>
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
                  exportToPdf();
                  setShowExportMenu(false);
                }}
                className="w-full p-4 bg-[var(--theme-bg-tertiary)] rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors text-left"
              >
                {strings.writer.buttons.exportPdf}
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
