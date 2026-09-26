import React, { useEffect, useRef, useState } from 'react';

/**
 * A secret typed into a row of stars.
 *
 * No visible box: an invisible input holds the focus and the keystrokes, and
 * a row of `*` shows how much has been typed. Empty slots sit dim and light
 * up as characters arrive; clicking the stars puts the focus back. `length`
 * is the number of slots drawn; with `grow` the row keeps adding stars past
 * that, so the same field takes a six-digit pin or a longer passphrase.
 *
 * Used for the account pin (set, confirm, unlock) and for slate locks.
 */
export function SecretField({
  value,
  onChange,
  length = 6,
  grow = false,
  numeric = false,
  autoFocus = false,
  onComplete,
  onSubmit,
  className = '',
}) {
  const inputRef = useRef(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [autoFocus]);

  const handleChange = (e) => {
    let next = e.target.value;
    if (numeric) next = next.replace(/\D/g, '');
    if (!grow) next = next.slice(0, length);
    onChange(next);
    if (!grow && next.length === length && value.length < length) onComplete?.(next);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  const slots = Math.max(length, grow ? value.length : 0);
  const stars = Array.from({ length: slots }, (_, i) => i < value.length);

  return (
    <div
      className={`relative flex justify-center select-none cursor-text ${className}`}
      onMouseDown={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
    >
      {/* A plain text field, not a password one: the stars already hide the
          value, and a password field would have the browser offer to save
          it. The data attributes keep password managers out of it too. */}
      <input
        ref={inputRef}
        type="text"
        name="secret-field"
        inputMode={numeric ? 'numeric' : 'text'}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore=""
        data-lpignore="true"
        data-bwignore=""
        data-form-type="other"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-text"
        style={{ color: 'transparent', caretColor: 'transparent', textShadow: 'none' }}
        aria-label="secret"
      />
      <div className="flex flex-wrap justify-center gap-x-2.5 text-2xl leading-none font-mono py-3">
        {stars.map((filled, i) => (
          <span
            key={i}
            className="transition-colors duration-200"
            style={{
              color: filled ? 'var(--theme-accent)' : 'var(--theme-text-dim)',
              opacity: filled ? 1 : focused && i === value.length ? 0.7 : 0.3,
            }}
          >
            *
          </span>
        ))}
      </div>
    </div>
  );
}
