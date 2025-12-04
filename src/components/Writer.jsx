import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { API_URL } from '../config';
import { VERSION } from '../version';
import { strings } from '../strings';

export const Writer = forwardRef(({ token, currentSlate, onSlateChange, onLogin, onZenModeChange, parentZenMode }, ref) => {
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('ready');
  const [zenMode, setZenMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPublishMenu, setShowPublishMenu] = useState(false);
  const [shareUrl, setShareUrl] = useState(null);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishModalUrl, setPublishModalUrl] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [wasPublishedBeforeEdit, setWasPublishedBeforeEdit] = useState(false);
  const textareaRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const saveMenuTimeoutRef = useRef(null);
  const lastSavedContentRef = useRef('');

  // Load current slate
  useEffect(() => {
    if (currentSlate && token) {
      setIsLoading(true);
      loadSlate(currentSlate.id);
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

  // Notify parent about zen mode changes
  useEffect(() => {
    if (onZenModeChange) {
      onZenModeChange(zenMode);
    }
  }, [zenMode, onZenModeChange]);

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
          // Not logged in - show login modal
          onLogin();
        } else if (currentSlate) {
          // Logged in with existing slate - auto-save
          saveSlate();
        }
      }
    }, 2000);

    return () => clearTimeout(saveTimeoutRef.current);
  }, [content, hasUnsavedChanges, token, currentSlate]);

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

      // Cmd/Ctrl + X: Export as TXT
      if (cmdOrCtrl && e.key === 'x') {
        e.preventDefault();
        exportToTxt();
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

  // Warn before closing with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges && content.trim()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges, content]);

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

  const loadSlate = async (id) => {
    try {
      const response = await fetch(`${API_URL}/slates/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
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
      setTitle(data.title);
      setContent(data.content);
      setShareUrl(data.is_published ? `${window.location.origin}/s/${data.share_id}` : null);
      setWasPublishedBeforeEdit(false); // Only set true after edit, not on load
      lastSavedContentRef.current = JSON.stringify({ content: data.content, title: data.title });
      setHasUnsavedChanges(false);
      setIsLoading(false);
    } catch (err) {
      console.error('Failed to load slate:', err);
      setIsLoading(false);
    }
  };

  const saveSlateSync = async () => {
    if (!title.trim() || !token || !currentSlate) return;

    setStatus('saving...');

    try {
      // Extract title from first line of content
      const firstLine = content.split('\n')[0].trim();
      const titleToSave = firstLine || 'untitled slate';

      const response = await fetch(`${API_URL}/slates/${currentSlate.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: titleToSave, content }),
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
    hasUnsavedChanges: () => hasUnsavedChanges
  }));

  const saveSlate = async () => {
    // Extract title from first line of content
    const firstLine = content.split('\n')[0].trim();
    const titleToSave = firstLine || 'untitled slate';

    if (!content.trim()) return null;

    setStatus('saving...');

    try {
      const method = currentSlate ? 'PUT' : 'POST';
      const url = currentSlate
        ? `${API_URL}/slates/${currentSlate.id}`
        : `${API_URL}/slates`;

      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: titleToSave, content }),
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

      lastSavedContentRef.current = JSON.stringify({ content, title });
      setHasUnsavedChanges(false);

      // Handle unpublishing due to edit
      if (data.was_unpublished) {
        setShareUrl(null);
        setWasPublishedBeforeEdit(true);
        setStatus(strings.writer.status.savedAsPrivate);
        setTimeout(() => setStatus(strings.writer.status.privateDraft), 3000);
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
    let slateToPublish = currentSlate;
    if (!slateToPublish) {
      setStatus('saving...');
      const savedSlate = await saveSlate();
      if (!savedSlate) {
        // Error status already set by saveSlate
        return;
      }
      slateToPublish = savedSlate;
    }

    // Detect if this is a first publish or republish
    const isFirstPublish = !wasPublishedBeforeEdit && !shareUrl;
    const isRepublish = wasPublishedBeforeEdit && !shareUrl;

    try {
      const response = await fetch(`${API_URL}/slates/${slateToPublish.id}/publish`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isPublished: !shareUrl }),
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

  const exportToPdf = () => {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title || 'Slate'}</title>
          <style>
            body {
              font-family: 'JetBrains Mono', monospace;
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

  return (
    <div className="relative flex flex-col bg-[#111111] h-full overflow-hidden">
      {/* LOADING OVERLAY */}
      {isLoading && (
        <div className="absolute inset-0 bg-[#111111] flex items-center justify-center z-50">
          <div className="text-[#666] text-sm">loading slate...</div>
        </div>
      )}

      {/* WRITING AREA */}
      <main className="flex-grow flex justify-center w-full bg-[#111111] overflow-y-auto">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={strings.writer.contentPlaceholder}
          spellCheck={false}
          className="w-full max-w-3xl bg-[#111111] border-none text-lg leading-relaxed resize-none p-8 focus:ring-0 placeholder-[#333333] text-[#d4d4d4]"
        />
      </main>

      {/* DESKTOP FOOTER */}
      <footer className={`hidden md:block px-8 py-4 border-t border-transparent bg-[#111111] transition-opacity duration-500 ${zenMode ? 'opacity-0 hover:opacity-100' : 'opacity-100'}`}>
        <div className="flex justify-between items-center gap-4 text-sm">

          {/* Left Controls */}
          <div className="flex gap-6 items-center">
            <button
              onClick={() => setZenMode(!zenMode)}
              className={`transition-colors duration-200 ${zenMode ? 'text-white' : 'hover:text-white'}`}
            >
              {zenMode ? strings.writer.zenMode.on : strings.writer.zenMode.off}
            </button>
            <span className="opacity-30">|</span>
            <div className="opacity-50 flex gap-4">
              <span>{strings.writer.stats.words(wordCount)}</span>
              <span>{strings.writer.stats.chars(charCount)}</span>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex gap-6 items-center">
            <span className={`transition-opacity duration-300 ${
              status === 'ready' ? 'opacity-0' : 'opacity-100'
            } ${
              status === strings.writer.status.privateDraft || status === strings.writer.status.savedAsPrivate ? 'text-orange-400' :
              status === 'saved' ? 'text-green-500' :
              'text-green-500'
            }`}>
              {status}
            </span>

            <button
              onClick={() => setShowAboutModal(true)}
              className="hover:text-white transition-colors duration-200"
            >
              {strings.writer.buttons.about}
            </button>

            {token && (
              <div className="relative">
                <button
                  onClick={() => {
                    if (wasPublishedBeforeEdit) {
                      // Republish directly without showing menu
                      handlePublish();
                    } else {
                      // Show menu for first publish or already published
                      setShowPublishMenu(!showPublishMenu);
                    }
                  }}
                  className={`hover:text-white transition-colors duration-200 ${
                    shareUrl ? 'text-blue-400' :
                    wasPublishedBeforeEdit ? 'text-orange-400' :
                    ''
                  }`}
                >
                  {shareUrl ? strings.writer.publishButton.published :
                   wasPublishedBeforeEdit ? strings.writer.publishButton.republish :
                   strings.writer.publishButton.publish}
                </button>
                {showPublishMenu && (
                  <div className="absolute bottom-full right-0 mb-2 bg-[#1a1a1a] border border-[#333] rounded shadow-2xl overflow-hidden min-w-[180px]">
                    <button
                      onClick={handlePublish}
                      className="w-full px-4 py-2 text-left hover:bg-[#333] hover:text-white transition-colors duration-200"
                    >
                      {shareUrl ? strings.writer.menu.unpublishSlate : strings.writer.menu.getShareLink}
                    </button>
                    {shareUrl && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(shareUrl);
                          setStatus(strings.writer.status.linkCopied);
                          setTimeout(() => setStatus(strings.writer.status.ready), 2000);
                        }}
                        className="w-full px-4 py-2 text-left hover:bg-[#333] hover:text-white transition-colors duration-200"
                      >
                        {strings.writer.menu.copyLink}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="relative">
              <button
                onMouseEnter={handleSaveMenuEnter}
                onMouseLeave={handleSaveMenuLeave}
                onClick={() => token ? saveSlate() : null}
                className="border border-[#333] px-6 py-2 rounded hover:bg-[#e5e5e5] hover:text-black hover:border-[#e5e5e5] transition-all duration-300 active:scale-95 flex items-center gap-2"
              >
                <span>{strings.writer.buttons.save}</span>
                {token && <span className="text-xs opacity-50">⌘S</span>}
              </button>
              {showSaveMenu && (
                <div
                  onMouseEnter={handleSaveMenuEnter}
                  onMouseLeave={handleSaveMenuLeave}
                  className="absolute bottom-full right-0 mb-1 bg-[#1a1a1a] border border-[#333] rounded shadow-2xl overflow-hidden min-w-[140px]"
                >
                  <button
                    onClick={exportToTxt}
                    className="w-full px-4 py-2 text-left hover:bg-[#333] hover:text-white transition-colors duration-200 flex justify-between items-center"
                  >
                    <span>{strings.writer.buttons.exportTxt}</span>
                    <span className="text-xs opacity-50 ml-4">⌘X</span>
                  </button>
                  <button
                    onClick={exportToPdf}
                    className="w-full px-4 py-2 text-left hover:bg-[#333] hover:text-white transition-colors duration-200 flex justify-between items-center"
                  >
                    <span>{strings.writer.buttons.exportPdf}</span>
                    <span className="text-xs opacity-50 ml-4">⌘P</span>
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
        className="md:hidden fixed bottom-6 right-6 w-14 h-14 bg-[#222] border border-[#333] rounded-full flex items-center justify-center hover:bg-[#333] transition-all duration-300 shadow-2xl z-50"
      >
        <svg className="w-6 h-6 text-[#a0a0a0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
      </button>

      {/* MOBILE BOTTOM SHEET */}
      {showMobileMenu && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => setShowMobileMenu(false)}
          />
          <div className="md:hidden fixed bottom-0 left-0 right-0 bg-[#1a1a1a] border-t border-[#333] rounded-t-2xl p-6 z-50 max-h-[70vh] overflow-y-auto">
            <div className="flex flex-col gap-6">

              {/* Stats */}
              <div className="flex gap-4 text-sm opacity-70">
                <div className="flex-1 p-4 bg-[#222] rounded-lg text-center">
                  <div className="text-2xl font-bold text-white">{wordCount}</div>
                  <div className="text-xs">words</div>
                </div>
                <div className="flex-1 p-4 bg-[#222] rounded-lg text-center">
                  <div className="text-2xl font-bold text-white">{charCount}</div>
                  <div className="text-xs">characters</div>
                </div>
              </div>

              {/* Status */}
              {status !== 'ready' && (
                <div className={`p-3 rounded-lg text-center text-sm ${
                  status === strings.writer.status.privateDraft || status === strings.writer.status.savedAsPrivate
                    ? 'bg-orange-900/20 border border-orange-700/50 text-orange-400'
                    : 'bg-green-900/20 border border-green-700/50 text-green-500'
                }`}>
                  {status}
                </div>
              )}

              {/* Save Button */}
              <button
                onClick={() => {
                  if (token) saveSlate();
                  else onLogin();
                  // Keep menu open to show status
                }}
                className="p-4 bg-white text-black rounded-lg hover:bg-[#e5e5e5] transition-colors font-medium text-base"
              >
                {strings.writer.menu.saveToAccount}
              </button>

              {/* Export Options */}
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    exportToTxt();
                    setShowMobileMenu(false);
                  }}
                  className="p-4 bg-[#222] rounded-lg hover:bg-[#333] transition-colors text-left"
                >
                  {strings.writer.menu.exportAsTXT}
                </button>
                <button
                  onClick={() => {
                    exportToPdf();
                    setShowMobileMenu(false);
                  }}
                  className="p-4 bg-[#222] rounded-lg hover:bg-[#333] transition-colors text-left"
                >
                  {strings.writer.menu.exportAsPDF}
                </button>
              </div>

              {/* About Button */}
              <div className="border-t border-[#333] pt-4">
                <button
                  onClick={() => {
                    setShowAboutModal(true);
                    setShowMobileMenu(false);
                  }}
                  className="w-full p-4 bg-[#222] rounded-lg hover:bg-[#333] transition-colors text-left"
                >
                  {strings.writer.menu.aboutJustType}
                </button>
              </div>

              {/* Publish Options */}
              {token && (
                <div className="border-t border-[#333] pt-4">
                  <button
                    onClick={() => {
                      handlePublish();
                      // Keep menu open to show status
                    }}
                    className={`w-full p-4 bg-[#222] rounded-lg hover:bg-[#333] transition-colors text-left ${
                      shareUrl ? 'text-blue-400' :
                      wasPublishedBeforeEdit ? 'text-orange-400' :
                      ''
                    }`}
                  >
                    {shareUrl ? strings.writer.menu.unpublishSlateAction :
                     wasPublishedBeforeEdit ? `${strings.writer.publishButton.republish} slate` :
                     strings.writer.menu.getShareLinkAction}
                  </button>
                  {shareUrl && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(shareUrl);
                        setStatus(strings.writer.status.linkCopied);
                        setTimeout(() => {
                          if (wasPublishedBeforeEdit) {
                            setStatus(strings.writer.status.privateDraft);
                          } else {
                            setStatus(strings.writer.status.ready);
                          }
                        }, 2000);
                        // Keep menu open
                      }}
                      className="w-full mt-3 p-4 bg-[#222] rounded-lg hover:bg-[#333] transition-colors text-left"
                    >
                      {strings.writer.menu.copyShareLink}
                    </button>
                  )}
                </div>
              )}

            </div>
          </div>
        </>
      )}

      {/* ABOUT MODAL */}
      {showAboutModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4" onClick={() => setShowAboutModal(false)}>
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg md:text-xl text-white mb-6">{strings.writer.about.title}</h2>
            <div className="space-y-4 text-sm text-[#a0a0a0]">
              <p>{strings.writer.about.description}</p>
              <p className="text-xs">{strings.writer.about.encryption}</p>
              <p className="text-xs">
                open-source at <a href="https://github.com/alfaoz/justtype" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">github</a> · by <a href="https://alfaoz.dev" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">alfaoz</a>
              </p>
              <p className="text-xs text-[#666] pt-2 border-t border-[#333]">
                {strings.writer.about.version(VERSION)}
              </p>
            </div>
            <button
              onClick={() => setShowAboutModal(false)}
              className="mt-6 w-full border border-[#333] py-2 md:py-3 rounded hover:bg-[#333] hover:text-white transition-all text-sm"
            >
              {strings.writer.about.close}
            </button>
          </div>
        </div>
      )}

      {/* PUBLISH MODAL */}
      {showPublishModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4" onClick={() => setShowPublishModal(false)}>
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg md:text-xl text-white mb-4">your slate is now public!</h2>
            <p className="text-sm text-[#a0a0a0] mb-4">anyone with this link can view your slate:</p>
            <div className="bg-[#111] border border-[#333] rounded p-3 mb-6 break-all text-sm text-blue-400">
              {publishModalUrl}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(publishModalUrl);
                  setStatus(strings.writer.status.linkCopied);
                  setTimeout(() => setStatus('ready'), 2000);
                }}
                className="flex-1 bg-white text-black py-2 md:py-3 rounded hover:bg-[#e5e5e5] transition-all text-sm font-medium"
              >
                copy link
              </button>
              <button
                onClick={() => setShowPublishModal(false)}
                className="flex-1 border border-[#333] py-2 md:py-3 rounded hover:bg-[#333] hover:text-white transition-all text-sm"
              >
                okay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
