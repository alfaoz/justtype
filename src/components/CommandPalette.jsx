import React, { useState, useEffect, useRef } from 'react';
import { searchCommands, getSubCommands, groupByCategory } from '../commands';

export function CommandPalette({
  isOpen,
  onClose,
  context,
  onExecute
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeSubMenu, setActiveSubMenu] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setActiveSubMenu(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Get filtered commands
  const results = activeSubMenu
    ? getSubCommands(activeSubMenu)
    : searchCommands(query, context);

  // Group results by category when not searching and not in sub-menu
  const grouped = !query && !activeSubMenu ? groupByCategory(results) : null;
  const flatResults = grouped
    ? grouped.flatMap(g => g.commands)
    : results;

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= flatResults.length) {
      setSelectedIndex(Math.max(0, flatResults.length - 1));
    }
  }, [flatResults.length, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.querySelector('[data-selected="true"]');
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          if (activeSubMenu) {
            setActiveSubMenu(null);
            setSelectedIndex(0);
          } else {
            onClose();
          }
          break;

        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 1, flatResults.length - 1));
          break;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, 0));
          break;

        case 'Enter':
          e.preventDefault();
          executeSelected();
          break;

        case 'ArrowRight':
        case 'Tab':
          if (flatResults[selectedIndex]?.hasSubCommands) {
            e.preventDefault();
            setActiveSubMenu(flatResults[selectedIndex].id);
            setSelectedIndex(0);
          }
          break;

        case 'ArrowLeft':
        case 'Backspace':
          if (activeSubMenu && !query) {
            e.preventDefault();
            setActiveSubMenu(null);
            setSelectedIndex(0);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, flatResults, selectedIndex, activeSubMenu, query]);

  const executeSelected = () => {
    const cmd = flatResults[selectedIndex];
    if (!cmd) return;

    if (cmd.hasSubCommands) {
      setActiveSubMenu(cmd.id);
      setSelectedIndex(0);
      return;
    }

    onExecute(cmd);
    onClose();
  };

  const handleItemClick = (cmd, index) => {
    if (cmd.hasSubCommands) {
      setActiveSubMenu(cmd.id);
      setSelectedIndex(0);
      return;
    }

    onExecute(cmd);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-start justify-center z-50 p-4 pt-[15vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg w-full max-w-lg overflow-hidden shadow-2xl animate-[fadeInUp_0.15s_ease-out]">
        {/* Search input */}
        <div className="p-4 border-b border-[#333]">
          <div className="flex items-center gap-3">
            {activeSubMenu && (
              <button
                onClick={() => {
                  setActiveSubMenu(null);
                  setSelectedIndex(0);
                }}
                className="text-[#666] hover:text-white"
              >
                &lt;
              </button>
            )}
            <span className="text-[#666]">&gt;</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder={activeSubMenu ? `${activeSubMenu}...` : 'type a command...'}
              className="flex-1 bg-transparent text-white focus:outline-none placeholder-[#666]"
              autoComplete="off"
              spellCheck="false"
            />
          </div>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto">
          {flatResults.length === 0 ? (
            <div className="px-4 py-8 text-center text-[#666] text-sm">
              no commands found
            </div>
          ) : grouped ? (
            // Grouped view (no query)
            grouped.map(group => (
              <div key={group.category}>
                <div className="px-4 py-2 text-xs text-[#666] uppercase tracking-wider">
                  {group.category}
                </div>
                {group.commands.map((cmd, idx) => {
                  const globalIdx = flatResults.indexOf(cmd);
                  return (
                    <CommandItem
                      key={cmd.id}
                      cmd={cmd}
                      isSelected={globalIdx === selectedIndex}
                      onClick={() => handleItemClick(cmd, globalIdx)}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                    />
                  );
                })}
              </div>
            ))
          ) : (
            // Flat list (searching or sub-menu)
            flatResults.map((cmd, idx) => (
              <CommandItem
                key={cmd.id}
                cmd={cmd}
                isSelected={idx === selectedIndex}
                onClick={() => handleItemClick(cmd, idx)}
                onMouseEnter={() => setSelectedIndex(idx)}
              />
            ))
          )}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2 border-t border-[#333] text-xs text-[#666] flex gap-4">
          <span>
            <span className="text-[#555]">↑↓</span> navigate
          </span>
          <span>
            <span className="text-[#555]">⏎</span> select
          </span>
          {activeSubMenu && (
            <span>
              <span className="text-[#555]">←</span> back
            </span>
          )}
          <span>
            <span className="text-[#555]">esc</span> close
          </span>
        </div>
      </div>
    </div>
  );
}

function CommandItem({ cmd, isSelected, onClick, onMouseEnter }) {
  return (
    <button
      data-selected={isSelected}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`w-full px-4 py-3 flex items-center justify-between text-left transition-colors ${
        isSelected ? 'bg-[#333]' : 'hover:bg-[#222]'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {cmd.icon && (
          <span className="text-[#666] w-5 text-center font-mono">{cmd.icon}</span>
        )}
        <span className={isSelected ? 'text-white' : 'text-[#a0a0a0]'}>
          {cmd.title}
        </span>
        {cmd.description && (
          <span className="text-[#666] text-sm truncate hidden sm:inline">
            {cmd.description}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {cmd.shortcut && (
          <span className="text-xs text-[#555] bg-[#222] px-2 py-1 rounded">
            {cmd.shortcut}
          </span>
        )}
        {cmd.hasSubCommands && (
          <span className="text-[#666]">→</span>
        )}
      </div>
    </button>
  );
}
