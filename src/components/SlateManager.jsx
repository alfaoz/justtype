import React, { useState, useEffect } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';
import { decryptTitle, encryptTitle } from '../crypto';
import { getSlateKey } from '../keyStore';

export function SlateManager({ token, userId, onSelectSlate, onNewSlate }) {
  const [slates, setSlates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteModal, setDeleteModal] = useState({ show: false, slateId: null, slateTitle: '' });
  const [openMenuId, setOpenMenuId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent'); // 'recent' | 'oldest' | 'a-z' | 'z-a' | 'words'
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('justtype-slate-view') || 'list'); // 'list' | 'grid'

  // Persist view mode to localStorage
  useEffect(() => {
    localStorage.setItem('justtype-slate-view', viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (token) {
      loadSlates();
    }
  }, [token]);

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

      // Get slate key for decryption
      const slateKey = userId ? await getSlateKey(userId) : null;

      if (slateKey) {
        // Decrypt encrypted titles for unpublished slates
        data = await Promise.all(data.map(async (slate) => {
          if (slate.encrypted_title && !slate.is_published) {
            try {
              const decryptedTitle = await decryptTitle(slate.encrypted_title, slateKey);
              return { ...slate, title: decryptedTitle };
            } catch (err) {
              console.error('Failed to decrypt title for slate:', slate.id, err);
              return { ...slate, title: '[encrypted]' };
            }
          }
          return slate;
        }));

        // Migration: encrypt plaintext titles for unpublished slates without encrypted_title
        const needsMigration = data.filter(s => !s.is_published && !s.encrypted_title && s.title);
        if (needsMigration.length > 0) {
          for (const slate of needsMigration) {
            try {
              const encryptedTitleBlob = await encryptTitle(slate.title, slateKey);
              await fetch(`${API_URL}/slates/${slate.id}/migrate-title`, {
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
        setSlates(prevSlates => prevSlates.filter(s => s.id !== id));
      } else {
        const data = await response.json();
        alert(data.error || strings.errors.deleteSlate);
      }
    } catch (err) {
      console.error('Failed to delete slate:', err);
      alert(strings.errors.deleteSlate);
    }
  };

  const togglePublish = async (id, currentlyPublished, e) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenMenuId(null);

    try {
      const response = await fetch(`${API_URL}/slates/${id}/publish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isPublished: !currentlyPublished }),
      });

      if (response.ok) {
        const data = await response.json();
        setSlates(prevSlates =>
          prevSlates.map(s =>
            s.id === id
              ? {
                  ...s,
                  is_published: !currentlyPublished,
                  share_id: data.share_id,
                  published_at: !currentlyPublished ? new Date().toISOString() : null,
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

  // Filter and sort slates
  const filteredAndSortedSlates = slates
    .filter(slate => {
      if (!searchQuery.trim()) return true;
      return slate.title.toLowerCase().includes(searchQuery.toLowerCase());
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'oldest':
          return new Date(a.updated_at) - new Date(b.updated_at);
        case 'a-z':
          return a.title.localeCompare(b.title);
        case 'z-a':
          return b.title.localeCompare(a.title);
        case 'words':
          return b.word_count - a.word_count;
        case 'recent':
        default:
          return new Date(b.updated_at) - new Date(a.updated_at);
      }
    });

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

        {/* Search and Sort Controls */}
        {slates.length > 0 && (
          <div className="flex flex-col md:flex-row gap-3 mb-6">
            {/* Search */}
            <div className="flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="search titles..."
                className="w-full bg-[#1a1a1a] border border-[#333] rounded px-4 py-2 focus:outline-none focus:border-[#666] text-white text-sm placeholder-[#666]"
              />
            </div>
            {/* Sort */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[#666]">sort:</span>
              <div className="flex gap-1 flex-wrap">
                {[
                  { id: 'recent', label: 'recent' },
                  { id: 'oldest', label: 'oldest' },
                  { id: 'a-z', label: 'a-z' },
                  { id: 'z-a', label: 'z-a' },
                  { id: 'words', label: 'words' },
                ].map(option => (
                  <button
                    key={option.id}
                    onClick={() => setSortBy(option.id)}
                    className={`px-2 py-1 rounded transition-colors ${
                      sortBy === option.id
                        ? 'bg-[#333] text-white'
                        : 'text-[#666] hover:text-white'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {/* View Mode Toggle */}
            <div className="flex items-center border border-[#333] rounded overflow-hidden">
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-[#333] text-white' : 'text-[#666] hover:text-white'}`}
                title="list view"
              >
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="1" y="2" width="14" height="2" rx="0.5"/>
                  <rect x="1" y="7" width="14" height="2" rx="0.5"/>
                  <rect x="1" y="12" width="14" height="2" rx="0.5"/>
                </svg>
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-[#333] text-white' : 'text-[#666] hover:text-white'}`}
                title="grid view"
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
          <p className="text-[#666] text-sm md:text-base">no slates match "{searchQuery}"</p>
        </div>
      ) : viewMode === 'list' ? (
        /* List View */
        <div className="space-y-3">
          {filteredAndSortedSlates.map((slate) => (
            <div
              key={slate.id}
              onClick={() => onSelectSlate(slate)}
              className="bg-[#1a1a1a] border border-[#333] p-3 md:p-4 rounded hover:border-[#666] transition-all cursor-pointer group"
            >
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="text-white text-sm md:text-lg mb-1 truncate">{slate.title}</h3>
                  {/* Desktop stats */}
                  <div className="hidden md:flex text-sm text-[#666] gap-4">
                    <span>{strings.slates.stats.words(slate.word_count)}</span>
                    <span>{strings.slates.stats.chars(slate.char_count)}</span>
                    <span>{strings.slates.stats.updated(formatDate(slate.updated_at))}</span>
                    {slate.is_published ? (
                      <span className="text-blue-400">{strings.slates.stats.published(formatDate(slate.published_at))}</span>
                    ) : slate.published_at ? (
                      <span className="text-orange-400">{strings.slates.stats.privateDraft}</span>
                    ) : (
                      <span className="text-[#666]">{strings.slates.stats.unpublished}</span>
                    )}
                  </div>
                  {/* Mobile stats */}
                  <div className="md:hidden text-xs text-[#666] space-y-1">
                    <div className="flex gap-3">
                      <span>{strings.slates.stats.wordsShort(slate.word_count)}</span>
                      <span>{strings.slates.stats.charsShort(slate.char_count)}</span>
                      <span>{formatDateShort(slate.updated_at)}</span>
                    </div>
                    {slate.is_published ? (
                      <div className="text-blue-400">{strings.slates.stats.pubShort(formatDateShort(slate.published_at))}</div>
                    ) : slate.published_at ? (
                      <div className="text-orange-400">{strings.slates.stats.privateDraft}</div>
                    ) : (
                      <div className="text-[#666]">{strings.slates.stats.unpublished}</div>
                    )}
                  </div>
                </div>
                <div className="relative flex-shrink-0">
                  <button
                    onClick={(e) => toggleMenu(slate.id, e)}
                    className="md:opacity-0 md:group-hover:opacity-100 opacity-100 text-[#666] hover:text-white transition-opacity p-1"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 16 16">
                      <circle cx="8" cy="2" r="1.5"/>
                      <circle cx="8" cy="8" r="1.5"/>
                      <circle cx="8" cy="14" r="1.5"/>
                    </svg>
                  </button>
                  {openMenuId === slate.id && (
                    <div className="absolute right-0 top-full mt-1 bg-[#1a1a1a] border border-[#333] rounded shadow-2xl overflow-hidden min-w-[140px] z-10">
                      <button
                        onClick={(e) => togglePublish(slate.id, slate.is_published, e)}
                        className="w-full px-4 py-2 text-left hover:bg-[#333] hover:text-white transition-colors text-xs md:text-sm"
                      >
                        {slate.is_published ? 'make private' : 'make public'}
                      </button>
                      <button
                        onClick={(e) => {
                          setOpenMenuId(null);
                          showDeleteConfirmation(slate.id, slate.title, e);
                        }}
                        className="w-full px-4 py-2 text-left hover:bg-[#333] text-red-500 hover:text-red-400 transition-colors text-xs md:text-sm"
                      >
                        {strings.slates.menu.delete}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Grid View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAndSortedSlates.map((slate) => (
            <div
              key={slate.id}
              onClick={() => onSelectSlate(slate)}
              className="bg-[#1a1a1a] border border-[#333] p-4 rounded hover:border-[#666] transition-all cursor-pointer group flex flex-col"
            >
              <div className="flex justify-between items-start gap-2 mb-3">
                <h3 className="text-white text-sm md:text-base font-medium truncate flex-1">{slate.title}</h3>
                <div className="relative flex-shrink-0">
                  <button
                    onClick={(e) => toggleMenu(slate.id, e)}
                    className="md:opacity-0 md:group-hover:opacity-100 opacity-100 text-[#666] hover:text-white transition-opacity p-1"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                      <circle cx="8" cy="2" r="1.5"/>
                      <circle cx="8" cy="8" r="1.5"/>
                      <circle cx="8" cy="14" r="1.5"/>
                    </svg>
                  </button>
                  {openMenuId === slate.id && (
                    <div className="absolute right-0 top-full mt-1 bg-[#1a1a1a] border border-[#333] rounded shadow-2xl overflow-hidden min-w-[140px] z-10">
                      <button
                        onClick={(e) => togglePublish(slate.id, slate.is_published, e)}
                        className="w-full px-4 py-2 text-left hover:bg-[#333] hover:text-white transition-colors text-xs md:text-sm"
                      >
                        {slate.is_published ? 'make private' : 'make public'}
                      </button>
                      <button
                        onClick={(e) => {
                          setOpenMenuId(null);
                          showDeleteConfirmation(slate.id, slate.title, e);
                        }}
                        className="w-full px-4 py-2 text-left hover:bg-[#333] text-red-500 hover:text-red-400 transition-colors text-xs md:text-sm"
                      >
                        {strings.slates.menu.delete}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="text-xs text-[#666] space-y-1 mt-auto">
                <div className="flex justify-between">
                  <span>{strings.slates.stats.wordsShort(slate.word_count)}</span>
                  <span>{formatDateShort(slate.updated_at)}</span>
                </div>
                {slate.is_published ? (
                  <div className="text-blue-400 text-xs">public</div>
                ) : slate.published_at ? (
                  <div className="text-orange-400 text-xs">draft (was public)</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal.show && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
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
      </div>
    </div>
  );
}
