// Nearby collab transport: a direct WebRTC data channel between devices on
// the same network, with no server anywhere. Signaling (the offer/answer
// handshake) travels as a short code shown as a QR or pasted by hand. The
// code carries only what the other side needs: DTLS fingerprint, ICE
// credentials, local candidates, SCTP port. The full SDP is rebuilt from it.
//
// Security: the fingerprint in the code authenticates the DTLS session, and
// the document updates that cross the channel are additionally wrapped in
// the slate's doc key, exactly as over the relay. Four words derived from
// both fingerprints let two people confirm by eye that they are connected
// to each other and not to a third machine.
import { wordlist } from './bip39-wordlist';

const CODE_PREFIX = 'jt1';
const GATHER_TIMEOUT_MS = 3000;

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

// SDP -> the handful of fields that matter for a data-channel-only session
export function compactSdp(sdp) {
  const get = (re) => (sdp.match(re) || [])[1];
  const cands = [...sdp.matchAll(/a=candidate:(\S+) 1 (udp|UDP) (\d+) (\S+) (\d+) typ host/g)]
    .map(m => [m[4], Number(m[5]), m[1], Number(m[3])]);
  return {
    u: get(/a=ice-ufrag:(\S+)/),
    p: get(/a=ice-pwd:(\S+)/),
    f: get(/a=fingerprint:sha-256 (\S+)/i),
    s: get(/a=setup:(\S+)/),
    sp: Number(get(/a=sctp-port:(\d+)/) || 5000),
    c: cands,
  };
}

export function expandSdp(c, type) {
  const lines = [
    'v=0', 'o=- 0 0 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', 'a=mid:0',
    `a=ice-ufrag:${c.u}`, `a=ice-pwd:${c.p}`, 'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${c.f}`, `a=setup:${c.s}`,
    `a=sctp-port:${c.sp}`, 'a=max-message-size:262144',
    ...c.c.map(([addr, port, found, prio]) => `a=candidate:${found} 1 udp ${prio} ${addr} ${port} typ host generation 0`),
    'a=end-of-candidates',
  ];
  return { type, sdp: lines.join('\r\n') + '\r\n' };
}

export const encodeCode = (kind, compact) => `${CODE_PREFIX}${kind}.${b64u(new TextEncoder().encode(JSON.stringify(compact)))}`;
export function decodeCode(text) {
  const m = String(text || '').trim().match(/^jt1([oa])\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  try {
    const compact = JSON.parse(new TextDecoder().decode(unb64u(m[2])));
    if (!compact.u || !compact.p || !compact.f || !Array.isArray(compact.c)) return null;
    return { kind: m[1] === 'o' ? 'offer' : 'answer', compact };
  } catch { return null; }
}

const gathered = (pc) => new Promise((resolve) => {
  if (pc.iceGatheringState === 'complete') return resolve();
  const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve(); };
  const check = () => { if (pc.iceGatheringState === 'complete') done(); };
  pc.addEventListener('icegatheringstatechange', check);
  setTimeout(done, GATHER_TIMEOUT_MS);
});

// Four words both screens can compare, from both fingerprints (order-free)
export async function confirmationWords(a, b) {
  const data = new TextEncoder().encode([a, b].sort().join('|'));
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const words = [];
  for (let i = 0; i < 4; i++) {
    const bits = (h[i * 2] << 8 | h[i * 2 + 1]) & 0x7ff; // 11 bits -> 2048 words
    words.push(wordlist[bits]);
  }
  return words;
}

const fingerprintOf = (desc) => (desc?.sdp.match(/a=fingerprint:sha-256 (\S+)/i) || [])[1] || '';

// One direct connection to one other device. Events: 'open', 'message'
// (detail: parsed object), 'close', 'failed'.
export class NearbyPeer extends EventTarget {
  constructor() {
    super();
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.channel = null;
    this.words = null;
    this.pc.addEventListener('connectionstatechange', () => {
      const s = this.pc.connectionState;
      if (s === 'failed') this.dispatchEvent(new Event('failed'));
      if (s === 'closed' || s === 'disconnected') this.dispatchEvent(new Event('close'));
    });
  }
  _wire(channel) {
    this.channel = channel;
    channel.onopen = async () => {
      this.words = await confirmationWords(fingerprintOf(this.pc.localDescription), fingerprintOf(this.pc.remoteDescription));
      this.dispatchEvent(new Event('open'));
    };
    channel.onclose = () => this.dispatchEvent(new Event('close'));
    channel.onmessage = (e) => {
      try { this.dispatchEvent(new CustomEvent('message', { detail: JSON.parse(e.data) })); } catch { /* ignore */ }
    };
  }
  // Side A: make the code to show
  async createOfferCode() {
    this._wire(this.pc.createDataChannel('justtype', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await gathered(this.pc);
    return encodeCode('o', compactSdp(this.pc.localDescription.sdp));
  }
  // Side B: read A's code, produce the reply code
  async acceptOfferCode(compact) {
    this.pc.ondatachannel = (e) => this._wire(e.channel);
    await this.pc.setRemoteDescription(expandSdp(compact, 'offer'));
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await gathered(this.pc);
    return encodeCode('a', compactSdp(this.pc.localDescription.sdp));
  }
  // Side A: read B's reply
  async acceptAnswerCode(compact) {
    await this.pc.setRemoteDescription(expandSdp(compact, 'answer'));
  }
  get open() { return this.channel?.readyState === 'open'; }
  send(obj) { if (this.open) this.channel.send(JSON.stringify(obj)); }
  close() { try { this.channel?.close(); } catch { /* already */ } try { this.pc.close(); } catch { /* already */ } }
}
