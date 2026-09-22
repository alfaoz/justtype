import React, { useEffect, useRef, useState } from 'react';
import { strings } from '../strings';
import { NearbyPeer, decodeCode } from '../nearby';
import { getNearbySession, onNearbyChange } from '../nearbySession';
import { canNativeScan, nativeScan, canShareLink, shareText } from '../shellMenu';

// The nearby tab of the collab panel: connect this device to another one on
// the same network with no server, by showing a code and reading the reply.
//
// Flow, side A ("show a code"): code on screen (QR + text) -> read B's reply
// (camera or paste) -> connected. Side B ("read a code"): read A's code ->
// reply code on screen -> connected once A reads it. After connecting, both
// screens show the same four words: if they match, you are talking to the
// device next to you. If the channel never comes up, the two devices are
// not on a common network and a short card says what to do about it.

const CONNECT_TIMEOUT_MS = 12000;
const t = () => strings.collab.nearby;

// QR of `text` into a canvas, library loaded on first use
function QrCode({ text }) {
  const ref = useRef(null);
  useEffect(() => {
    let cancelled = false;
    import('qrcode').then((QR) => {
      if (cancelled || !ref.current) return;
      QR.toCanvas(ref.current, text, { errorCorrectionLevel: 'L', margin: 1, width: 240, color: { dark: '#000000', light: '#ffffff' } }).catch(() => {});
    });
    return () => { cancelled = true; };
  }, [text]);
  return <canvas ref={ref} className="nearby-qr" aria-label={t().qrLabel} />;
}

// On the phone: its own camera sheet reads the code, opened at once and again
// from `scan`; pasting stays for when there is no camera
function NativeCodeReader({ expect, onCode }) {
  const [pasted, setPasted] = useState('');
  const [bad, setBad] = useState(false);
  const scan = async () => {
    setBad(false);
    const text = await nativeScan(t().pointCamera);
    if (!text) return;
    if (decodeCode(text)?.kind === expect) onCode(text); else setBad(true);
  };
  useEffect(() => { scan(); }, [expect]);
  const usePasted = () => {
    const d = decodeCode(pasted);
    if (d?.kind === expect) onCode(pasted.trim()); else setBad(true);
  };
  return (
    <div className="flex flex-col gap-3">
      <button onClick={scan} className="sheet-primary py-2">{t().scan}</button>
      {bad && <p className="text-[var(--theme-red)] text-xs">{t().badCode}</p>}
      <textarea
        value={pasted}
        onChange={(e) => { setPasted(e.target.value); setBad(false); }}
        placeholder={t().pastePlaceholder}
        rows={2}
        spellCheck={false}
        className="w-full text-xs p-2 rounded border bg-[var(--theme-bg)] border-[var(--theme-border)] text-[var(--theme-text)] font-mono"
      />
      {pasted.trim() && <button onClick={usePasted} className="sheet-secondary py-2">{t().useCode}</button>}
    </div>
  );
}

// Reads a QR from the camera (BarcodeDetector, else jsQR) or a pasted code
function CodeReader({ expect, onCode }) {
  if (canNativeScan) return <NativeCodeReader expect={expect} onCode={onCode} />;
  return <WebCodeReader expect={expect} onCode={onCode} />;
}

function WebCodeReader({ expect, onCode }) {
  const videoRef = useRef(null);
  const [pasted, setPasted] = useState('');
  const [cameraError, setCameraError] = useState(false);
  const [bad, setBad] = useState(false);

  useEffect(() => {
    let stream = null, timer = null, cancelled = false;
    const canvas = document.createElement('canvas');
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) { stream.getTracks().forEach(tr => tr.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      } catch { setCameraError(true); return; }
      const detector = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
      const jsqr = detector ? null : (await import('jsqr')).default;
      const tick = async () => {
        if (cancelled) return;
        const v = videoRef.current;
        if (v && v.readyState >= 2) {
          let text = null;
          try {
            if (detector) {
              const codes = await detector.detect(v);
              text = codes[0]?.rawValue || null;
            } else {
              canvas.width = v.videoWidth; canvas.height = v.videoHeight;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(v, 0, 0);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              text = jsqr(img.data, img.width, img.height)?.data || null;
            }
          } catch { /* frame not ready */ }
          if (text && decodeCode(text)?.kind === expect) { onCode(text); return; }
        }
        timer = setTimeout(tick, 250);
      };
      tick();
    })();
    return () => { cancelled = true; clearTimeout(timer); if (stream) stream.getTracks().forEach(tr => tr.stop()); };
  }, [expect, onCode]);

  const usePasted = () => {
    const d = decodeCode(pasted);
    if (d?.kind === expect) onCode(pasted.trim());
    else setBad(true);
  };

  return (
    <div className="flex flex-col gap-3">
      {!cameraError && <video ref={videoRef} className="nearby-video" muted playsInline />}
      <p className="text-xs text-[var(--theme-text-dim)]">{cameraError ? t().noCamera : t().pointCamera}</p>
      <textarea
        value={pasted}
        onChange={(e) => { setPasted(e.target.value); setBad(false); }}
        placeholder={t().pastePlaceholder}
        rows={3}
        spellCheck={false}
        className="w-full text-xs p-2 rounded border bg-[var(--theme-bg)] border-[var(--theme-border)] text-[var(--theme-text)] font-mono"
      />
      <div className="flex items-center gap-3 text-sm">
        <button onClick={usePasted} className="text-[var(--theme-accent)] hover:opacity-70 transition-opacity">{t().useCode}</button>
        {bad && <span className="text-[var(--theme-red)] text-xs">{t().badCode}</span>}
      </div>
    </div>
  );
}

function CodeDisplay({ code, hint }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <QrCode text={code} />
      <p className="text-xs text-[var(--theme-text-dim)]">{hint}</p>
      {/* On a phone the code goes out through the share sheet (airdrop,
          messages); the raw text and copy are for everywhere else */}
      {canShareLink ? (
        <button onClick={(e) => shareText(code, e.currentTarget)} className="sheet-secondary py-2">{t().share}</button>
      ) : (
        <>
          <textarea readOnly value={code} rows={3} spellCheck={false} onFocus={(e) => e.target.select()}
            className="w-full text-xs p-2 rounded border bg-[var(--theme-bg)] border-[var(--theme-border)] text-[var(--theme-text-muted)] font-mono" />
          <button
            onClick={() => { navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
            className="self-start text-sm text-[var(--theme-accent)] hover:opacity-70 transition-opacity"
          >
            {copied ? t().copied : t().copy}
          </button>
        </>
      )}
    </div>
  );
}

// Same wi-fi, in three lines, shown only when a connection never came up
function NetworkCard({ onRetry }) {
  const n = t().network;
  return (
    <div className="rounded border border-[var(--theme-border)] p-3 flex flex-col gap-2 text-sm">
      <p className="text-[var(--theme-text)]">{n.title}</p>
      <p className="text-xs text-[var(--theme-text-muted)]">{n.mac}</p>
      <p className="text-xs text-[var(--theme-text-muted)]">{n.android}</p>
      <p className="text-xs text-[var(--theme-text-muted)]">{n.linux}</p>
      <p className="text-xs text-[var(--theme-text-dim)]">{n.then}</p>
      <button onClick={onRetry} className="self-start text-[var(--theme-accent)] hover:opacity-70 transition-opacity">{n.retry}</button>
    </div>
  );
}

export function NearbyTab({ slateId, getDoc }) {
  const [step, setStep] = useState('idle'); // idle | showing | readingReply | reading | replying | connecting | failed
  const [code, setCode] = useState('');
  const [peers, setPeers] = useState([]);
  const peerRef = useRef(null);
  const timerRef = useRef(null);

  const session = () => getNearbySession(slateId, getDoc);
  const refreshPeers = () => { const s = session(); setPeers(s ? [...s.peers].filter(p => p.open) : []); };
  useEffect(() => { refreshPeers(); return onNearbyChange(refreshPeers); }, [slateId]);

  const reset = () => {
    clearTimeout(timerRef.current);
    if (peerRef.current && !peerRef.current.open) peerRef.current.close();
    peerRef.current = null;
    setCode('');
    setStep('idle');
  };

  // A fresh peer that reports back into this tab's state when it connects
  const newPeer = () => {
    const peer = new NearbyPeer();
    peer.addEventListener('open', () => { clearTimeout(timerRef.current); session()?.attach(peer); peerRef.current = null; setStep('idle'); setCode(''); refreshPeers(); });
    peer.addEventListener('failed', () => { clearTimeout(timerRef.current); setStep('failed'); });
    peerRef.current = peer;
    return peer;
  };
  const armTimeout = () => { clearTimeout(timerRef.current); timerRef.current = setTimeout(() => { if (peerRef.current && !peerRef.current.open) setStep('failed'); }, CONNECT_TIMEOUT_MS); };

  const showCode = async () => {
    const peer = newPeer();
    setStep('showing');
    try { setCode(await peer.createOfferCode()); } catch (e) { console.warn('nearby offer failed', e); setStep('failed'); }
  };
  const readReply = async (text) => {
    const d = decodeCode(text);
    if (!d || !peerRef.current) return;
    setStep('connecting');
    armTimeout();
    try { await peerRef.current.acceptAnswerCode(d.compact); } catch (e) { console.warn('nearby answer failed', e); setStep('failed'); }
  };
  const readOffer = async (text) => {
    const d = decodeCode(text);
    if (!d) return;
    const peer = newPeer();
    setStep('replying');
    try {
      setCode(await peer.acceptOfferCode(d.compact));
      armTimeout();
    } catch (e) { console.warn('nearby reply failed', e); setStep('failed'); }
  };

  const disconnect = (peer) => { peer.close(); refreshPeers(); };
  const s = t();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-4 text-sm">
      {peers.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-[var(--theme-text-dim)]">{s.connectedHeading}</p>
          {peers.map((p, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <span className="text-[var(--theme-text)]">{(p.words || []).join(' ')}</span>
              <button onClick={() => disconnect(p)} className="text-xs text-[var(--theme-text-dim)] hover:text-white transition-colors">{s.disconnect}</button>
            </div>
          ))}
          <p className="text-xs text-[var(--theme-text-dim)]">{s.wordsHint}</p>
        </div>
      )}

      {step === 'idle' && (
        <>
          <p className="text-[var(--theme-text-muted)]">{s.explainer}</p>
          <div className="flex items-center gap-4">
            <button onClick={showCode} className="nearby-choice text-[var(--theme-accent)] hover:opacity-70 transition-opacity">{s.showCode}</button>
            <button onClick={() => setStep('reading')} className="nearby-choice text-[var(--theme-accent)] hover:opacity-70 transition-opacity">{s.readCode}</button>
          </div>
        </>
      )}

      {step === 'showing' && (code
        ? <>
            <CodeDisplay code={code} hint={s.showHint} />
            <button onClick={() => setStep('readingReply')} className="nearby-next self-start text-[var(--theme-accent)] hover:opacity-70 transition-opacity">{s.readReply}</button>
          </>
        : <p className="text-[var(--theme-text-dim)] animate-pulse">{s.preparing}</p>
      )}

      {step === 'readingReply' && <CodeReader expect="answer" onCode={readReply} />}
      {step === 'reading' && <CodeReader expect="offer" onCode={readOffer} />}

      {step === 'replying' && (code
        ? <CodeDisplay code={code} hint={s.replyHint} />
        : <p className="text-[var(--theme-text-dim)] animate-pulse">{s.preparing}</p>
      )}

      {step === 'connecting' && <p className="text-[var(--theme-text-dim)] animate-pulse">{s.connecting}</p>}

      {step === 'failed' && <NetworkCard onRetry={reset} />}

      {step !== 'idle' && step !== 'failed' && (
        <button onClick={reset} className="self-start text-xs text-[var(--theme-text-dim)] hover:text-white transition-colors">{s.cancel}</button>
      )}
    </div>
  );
}
