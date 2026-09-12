// The writing size steps (`size: small base large larger`), shared by the
// writer and the public reader. The classes live in index.css as .punto-*.
export const PUNTO_SIZES = ['small', 'base', 'large', 'larger'];

export const nextPunto = (p) => PUNTO_SIZES[(PUNTO_SIZES.indexOf(p) + 1) % PUNTO_SIZES.length];

export const readPunto = () => {
  try { const v = localStorage.getItem('justtype-punto'); return PUNTO_SIZES.includes(v) ? v : 'base'; } catch { return 'base'; }
};
