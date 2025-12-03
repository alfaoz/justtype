import React, { useState, useEffect } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';

export function SlateManager({ token, onSelectSlate, onNewSlate }) {
  const [slates, setSlates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteModal, setDeleteModal] = useState({ show: false, slateId: null, slateTitle: '' });
  const [openMenuId, setOpenMenuId] = useState(null);

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
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await response.json();
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
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (response.ok) {
        setSlates(prevSlates => prevSlates.filter(s => s.id !== id));
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to delete slate');
      }
    } catch (err) {
      console.error('Failed to delete slate:', err);
      alert('Failed to delete slate');
    }
  };

  const togglePublish = async (id, currentlyPublished, e) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenMenuId(null);

    try {
      const response = await fetch(`${API_URL}/slates/${id}/publish`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
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
        alert(data.error || 'Failed to update publish status');
      }
    } catch (err) {
      console.error('Failed to toggle publish:', err);
      alert('Failed to update publish status');
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#666]">{strings.slates.loading}</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <div className="flex justify-between items-center mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl text-white">{strings.slates.title}</h1>
        <button
          onClick={onNewSlate}
          className="border border-[#333] px-4 md:px-6 py-2 rounded hover:bg-[#e5e5e5] hover:text-black hover:border-[#e5e5e5] transition-all duration-300 text-xs md:text-sm"
        >
          {strings.slates.newSlate}
        </button>
      </div>

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
      ) : (
        <div className="space-y-3">
          {slates.map((slate) => (
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
                        {slate.is_published ? strings.slates.menu.unpublish : strings.slates.menu.publish}
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
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal.show && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-white mb-4">{strings.slates.deleteModal.title}</h2>
            <p className="text-sm text-[#666] mb-6">
              {strings.slates.deleteModal.message(deleteModal.slateTitle)}
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
  );
}
