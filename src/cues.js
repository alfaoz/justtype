// Cues: a small sound, a small buzz, on the moments that matter (a save, a
// lock opening or closing). Both off by default; the account page's
// accessibility section turns them on for this device. Sounds are made here
// with the Web Audio API, so nothing is fetched and nothing plays before the
// browser has seen a gesture.
import { makePref } from './pref';
import { onLockChange } from './slateLock';
import { inShell } from './shell';

export const soundsPref = makePref({ key: 'justtype-sounds', values: ['off', 'on'], fallback: 'off' });
// In the app the phone's own haptics answer, and they start on, as a phone
// app's do; the web's buzz stays off until asked for
export const hapticsPref = makePref({ key: 'justtype-haptics', values: ['off', 'on'], fallback: inShell ? 'on' : 'off' });
// Desktop Chrome exposes vibrate() and does nothing with it; the row is only
// worth showing where there is a hand on the glass
export const canVibrate = inShell || (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
  && typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);

// The app's haptics (ShellBar.haptic): kinds are the phone's own, selection,
// light, soft, medium, rigid, success, warning, error
const nativeHaptic = (kind) => window.Capacitor?.nativePromise?.('ShellBar', 'haptic', { kind })?.catch?.(() => {});
const nativeKinds = { save: 'success', unlock: 'success', lock: 'medium' };

// A touch of feedback for the page's own controls (a choice made); only in
// the app, where it feels like the rest of the phone
export function tap(kind = 'selection') {
  if (inShell && hapticsPref.get() === 'on') nativeHaptic(kind);
}

let ctx = null;
function audio() {
  if (!ctx) {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// One quiet note: a sine that fades in a hair and out gently
function note(c, freq, at, dur, gain = 0.05, type = 'sine') {
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const sounds = {
  save: (c) => note(c, 1320, 0, 0.06, 0.04, 'triangle'),          // a tick
  unlock: (c) => { note(c, 440, 0, 0.1); note(c, 660, 0.09, 0.16); }, // rising
  lock: (c) => { note(c, 660, 0, 0.1); note(c, 440, 0.09, 0.16); },   // falling
};
const buzz = { save: 10, unlock: [12, 40, 12], lock: [12, 40, 12] };

export function cue(name) {
  if (soundsPref.get() === 'on') {
    const c = audio();
    if (c) sounds[name]?.(c);
  }
  if (hapticsPref.get() === 'on' && canVibrate) {
    if (inShell) nativeHaptic(nativeKinds[name] || 'light');
    else { try { navigator.vibrate(buzz[name] || 10); } catch {} }
  }
}

// The native controls (dock, pill, menus) follow the same setting
if (inShell) {
  const sync = (v) => window.Capacitor?.nativePromise?.('ShellBar', 'haptics', { on: v === 'on' })?.catch?.(() => {});
  sync(hapticsPref.get());
  hapticsPref.subscribe(sync);
}

if (typeof window !== 'undefined') {
  // Wake the audio context on the first gesture, so a later save (which may
  // not be one) is allowed to sound
  const arm = () => { if (soundsPref.get() === 'on') audio(); };
  window.addEventListener('pointerdown', arm, { passive: true });
  window.addEventListener('keydown', arm, { passive: true });
  // The lock speaks for itself: opening with a secret or taking the lock off
  // rises, locking falls. Relocks on idle or on leaving a slate stay silent.
  onLockChange((ev) => {
    if (ev.type === 'open' || ev.type === 'unlocked') cue('unlock');
    else if (ev.type === 'locked') cue('lock');
  });
}
