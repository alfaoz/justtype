import React from 'react';
import { strings } from '../strings';
import { HoverNote } from './HoverNote';

/**
 * The two support buttons under the "chip in" line: donate once, subscribe.
 * Shared by the about modal and the account page so they cannot drift.
 *
 * While payments are closed the pair renders disabled: dimmer, no hover
 * lift, and a HoverNote saying so instead of a click.
 */
export function SupportButtons({ onDonate, onSubscribe, disabled = false }) {
  const s = strings.writer.about.support;
  const items = [
    { label: s.donate, hint: s.donateHint, onClick: onDonate },
    { label: s.subscribe, hint: s.subscribeHint, onClick: onSubscribe },
  ];

  return (
    <div className="flex gap-2">
      {items.map(({ label, hint, onClick }) => {
        const button = (
          <button
            type="button"
            aria-disabled={disabled || undefined}
            onClick={disabled ? undefined : onClick}
            className={`w-full border border-[var(--theme-border)] rounded px-3 py-2.5 transition-colors ${
              disabled
                ? 'opacity-50 cursor-not-allowed text-[var(--theme-text-muted)]'
                : 'hover:bg-[var(--theme-bg-tertiary)] hover:text-[var(--theme-accent)]'
            }`}
          >
            <span className="block text-xs">{label}</span>
            <span className="block text-[10px] text-[var(--theme-text-dim)] mt-0.5">{hint}</span>
          </button>
        );
        if (!disabled) return <div key={label} className="flex-1">{button}</div>;
        return (
          <HoverNote key={label} plain note={s.disabled} className="flex-1 !flex">
            {button}
          </HoverNote>
        );
      })}
    </div>
  );
}
