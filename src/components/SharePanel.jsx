import React, { useState } from 'react';
import { strings } from '../strings';
import { ChoiceRow } from './ChoiceRow';
import { SecretField } from './SecretField';
import { useEscape } from '../useEscape';
import { EXPIRY_CHOICES } from '../share';

/**
 * Everything about a slate's link, as rows in the settings grammar:
 *   link: off public private
 *   open with: link passphrase        (private links)
 *   expires: never day week month
 * then the address with copy, and the way to forget it was ever public.
 * A side panel like the collab panel, so the slate stays in view.
 *
 * `share` { mode, openWith, expires, url, wasPublic, busy }
 * `onChange(patch)` applies one change; a passphrase change carries the
 * phrase in `patch.passphrase`.
 */
export function SharePanel({ share, onChange, onForget, onClose }) {
  const s = strings.writer.share;
  const [closing, setClosing] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const requestClose = () => { if (closing) return; setClosing(true); setTimeout(onClose, 200); };
  useEscape(!closing, requestClose);

  const copy = async () => {
    if (!share.url) return;
    try { await navigator.clipboard.writeText(share.url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* nothing to say */ }
  };
  const submitPhrase = () => {
    if (phrase.trim().length < 4) return;
    onChange({ openWith: 'passphrase', passphrase: phrase.trim() });
    setPhrase('');
  };

  return (
    <aside
      className="collab-panel fixed inset-0 z-50 md:static md:z-auto md:flex-shrink-0 flex flex-col border-l"
      data-closing={closing ? 'true' : 'false'}
      style={{ background: 'var(--theme-bg-secondary)', borderColor: 'var(--theme-border)' }}
    >
      <div className="collab-panel-inner">
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <span className="text-sm pb-1 border-b-2" style={{ borderColor: 'var(--theme-accent)', color: 'var(--theme-accent)' }}>{s.title}</span>
          <button onClick={requestClose} aria-label={strings.collab.panel.close} className="text-[var(--theme-text-dim)] hover:text-white transition-colors text-lg leading-none px-1">&times;</button>
        </div>

        <div className={`flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-5 text-xs md:text-sm ${share.busy ? 'opacity-60 pointer-events-none' : ''}`}>
          <ChoiceRow
            label={s.link}
            options={[{ id: 'off', label: s.off }, { id: 'public', label: s.public }, { id: 'private', label: s.private }]}
            value={share.mode}
            onChange={(mode) => mode !== share.mode && onChange({ mode })}
          />
          <p className="text-[var(--theme-text-dim)] -mt-3">{s.hint[share.mode]}</p>

          {share.mode === 'private' && (
            <>
              <ChoiceRow
                label={s.openWith}
                options={[{ id: 'link', label: s.byLink }, { id: 'passphrase', label: s.byPassphrase }]}
                value={share.openWith}
                onChange={(openWith) => (openWith === 'link' ? share.openWith !== 'link' && onChange({ openWith: 'link' }) : share.openWith !== 'passphrase' && onChange({ openWith: 'passphrase', pending: true }))}
              />
              {(share.openWith === 'passphrase') && (
                <div className="flex flex-col items-start gap-2 -mt-2">
                  <SecretField value={phrase} onChange={setPhrase} grow onSubmit={submitPhrase} autoFocus={!share.hasPassphrase} />
                  <div className="flex items-center gap-4 text-[var(--theme-text-dim)]">
                    <span>{share.hasPassphrase ? s.passphraseSet : s.passphraseHint}</span>
                    <button onClick={submitPhrase} disabled={phrase.trim().length < 4} className="text-[var(--theme-text)] hover:opacity-70 transition-opacity disabled:opacity-40">{share.hasPassphrase ? s.passphraseChange : s.passphraseSetGo}</button>
                  </div>
                </div>
              )}
            </>
          )}

          {share.mode !== 'off' && (
            <ChoiceRow
              label={s.expires}
              options={EXPIRY_CHOICES.map(id => ({ id, label: s.expiry[id] }))}
              value={share.expires}
              onChange={(expires) => expires !== share.expires && onChange({ expires })}
            />
          )}

          {share.url && (
            <div className="flex items-center gap-3 min-w-0">
              <span className="truncate text-[var(--theme-text-muted)]" title={share.url}>{share.url.replace(/^https?:\/\//, '')}</span>
              <button onClick={copy} className="text-[var(--theme-text)] hover:opacity-70 transition-opacity whitespace-nowrap">{copied ? s.copied : s.copy}</button>
            </div>
          )}

          {share.wasPublic && share.mode === 'off' && (
            <button
              onClick={() => { if (confirmForget) { setConfirmForget(false); onForget(); } else { setConfirmForget(true); setTimeout(() => setConfirmForget(false), 3000); } }}
              className="self-start text-[var(--theme-red)] hover:opacity-70 transition-opacity"
            >
              {confirmForget ? strings.writer.publishMenu.forgetConfirm : strings.writer.publishMenu.forget}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
