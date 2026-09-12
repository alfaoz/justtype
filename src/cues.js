// Cues: a small sound, a small buzz, on the moments that matter (a save, a
// lock opening or closing). Both off by default; the account page's
// accessibility section turns them on for this device. Sounds are made here
// with the Web Audio API, so nothing is fetched and nothing plays before the
// browser has seen a gesture.
import { makePref } from './pref';
import { onLockChange } from './slateLock';

export const soundsPref = makePref({ key: 'justtype-sounds', values: ['off', 'on'], fallback: 'off' });
export const hapticsPref = makePref({ key: 'justtype-haptics', values: ['off', 'on'], fallback: 'off' });
export const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

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
    try { navigator.vibrate(buzz[name] || 10); } catch {}
  }
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
