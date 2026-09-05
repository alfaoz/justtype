import React, { useState, useEffect, useRef, useMemo } from 'react';

/**
 * Strip lab: alternative layouts for the writer's settings row, switchable at
 * runtime so they can be compared in the real app. Enable with ?strip=on (or
 * ?strip=<variant>), disable with ?strip=off. The choice sticks in
 * localStorage. Once a direction is picked this file collapses into it.
 *
 * Every variant renders from the same control model built in Writer.jsx:
 *   { device: [...], slate: [...], actions: [...] }
 *   control = { id, label, value, options?, kind: 'cycle'|'toggle'|'action',
 *               onCycle?, onSet?(v), onClick?(e), onOpen?(e), active?, pulse?, key }
 */

export const STRIP_VARIANTS = [
  { id: 'current', name: 'current', note: 'what beta has today' },
  { id: 'grammar', name: 'grammar', note: 'every state control reads noun: value; grouped by scope with |; click cycles, hover names the cycle' },
  { id: 'sentence', name: 'sentence', note: 'the settings read as one line of prose; click a word to change it' },
  { id: 'statusline', name: 'status line', note: 'values only, like an editor status line; the label appears on hover; off toggles go dim' },
  { id: 'dots', name: 'dots', note: 'toggles are filled or hollow dots, cyclers use a caret before the value' },
  { id: 'chips', name: 'chips', note: 'the mobile chips brought to desktop; a filled chip is on' },
  { id: 'keys', name: 'keys', note: 'grammar plus an underlined letter per control; with the row open, press the letter' },
  { id: 'tabs', name: 'tabs', note: 'three section words; click one and the row swaps to that section' },
  { id: 'reveal', name: 'reveal', note: 'three section words; hovering one unfolds its controls inline' },
  { id: 'stack', name: 'stack', note: 'a column rises from the pill, grouped, never scrolls' },
  { id: 'panel', name: 'panel', note: 'a three-column card above the pill: device, this slate, actions' },
  { id: 'prompt', name: 'prompt', note: 'a command line: type theme sepia or focus, Enter applies, completions above' },
];

const STORAGE_KEY = 'justtype-strip-lab';
const POPUP_VARIANTS = new Set(['stack', 'panel']);

export function isPopupVariant(id) {
  return POPUP_VARIANTS.has(id);
}

// ?strip=on|off|<id> wins over what is stored. Returns null when the lab is off.
export function useStripVariant() {
  const [variant, setVariantState] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('strip');
      if (q === 'off') { localStorage.removeItem(STORAGE_KEY); return null; }
      if (q === 'on' || q === '1') { const v = localStorage.getItem(STORAGE_KEY) || 'current'; localStorage.setItem(STORAGE_KEY, v); return v; }
      if (q && STRIP_VARIANTS.some((v) => v.id === q)) { localStorage.setItem(STORAGE_KEY, q); return q; }
      return localStorage.getItem(STORAGE_KEY);
    } catch { return null; }
  });
  const setVariant = (id) => {
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id); else localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setVariantState(id);
  };
  return [variant, setVariant];
}

// Small fixed picker so the variants can be flipped through without reloading
export function StripLabSwitcher({ variant, onChange }) {
  const idx = Math.max(0, STRIP_VARIANTS.findIndex((v) => v.id === variant));
  const cur = STRIP_VARIANTS[idx];
  const go = (d) => onChange(STRIP_VARIANTS[(idx + d + STRIP_VARIANTS.length) % STRIP_VARIANTS.length].id);
  return (
    <div
      className="fixed top-3 right-3 z-[300] text-xs rounded px-3 py-2 max-w-[340px] select-none"
      onMouseDown={(e) => e.stopPropagation()} // not "outside" for the strip's close-on-click-away
      style={{ backgroundColor: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)' }}
    >
      <div className="flex items-center gap-3">
        <span style={{ color: 'var(--theme-text-dim)' }}>strip lab</span>
        <button onClick={() => go(-1)} className="hover:opacity-70 px-1">‹</button>
        <span style={{ color: 'var(--theme-text)' }}>{idx + 1}/{STRIP_VARIANTS.length} {cur.name}</span>
        <button onClick={() => go(1)} className="hover:opacity-70 px-1">›</button>
        <button onClick={() => onChange(null)} className="ml-auto hover:opacity-70" style={{ color: 'var(--theme-text-dim)' }}>off</button>
      </div>
      <div className="mt-1 leading-snug" style={{ color: 'var(--theme-text-dim)' }}>{cur.note}</div>
    </div>
  );
}

/* ---------- shared bits ---------- */

const btnBase = 'transition-colors duration-200 hover:opacity-70 text-sm whitespace-nowrap';
const Sep = () => <span className="opacity-30">·</span>;
const Bar = () => <span className="opacity-30 px-1">|</span>;

function hintFor(c) {
  if (c.kind === 'cycle' && c.options?.length) {
    const i = c.options.indexOf(c.value);
    const next = c.options[(i + 1) % c.options.length];
    return `${c.label}: ${c.value} → ${next}`;
  }
  if (c.kind === 'toggle') return `${c.label}: ${c.value} → ${c.value === 'on' ? 'off' : 'on'}`;
  return c.hint || c.label;
}

function nextValue(c) {
  if (c.kind === 'toggle') return c.value === 'on' ? 'off' : 'on';
  if (c.options?.length) return c.options[(c.options.indexOf(c.value) + 1) % c.options.length];
  return null;
}

function fire(c, e) {
  if (c.kind === 'action') c.onClick?.(e);
  else c.onCycle?.(e);
}

function color(c) {
  if (c.active) return 'rgb(167 139 250)';
  return 'var(--theme-accent)';
}

// Text-only control button. Cyclers cycle on click; theme also opens its
// picker on right-click so the full list stays reachable.
function Ctl({ c, children, className = '', style }) {
  return (
    <button
      onClick={(e) => fire(c, e)}
      onContextMenu={c.onOpen ? (e) => { e.preventDefault(); c.onOpen(e); } : undefined}
      title={hintFor(c) + (c.onOpen ? ' · right-click for the list' : '')}
      className={`${btnBase} ${c.pulse ? 'feature-pulse' : ''} ${className}`}
      style={{ color: color(c), ...style }}
      {...(c.id === 'theme' ? { 'data-theme-picker': true } : {})}
    >
      {children}
    </button>
  );
}

function joined(items, sep = <Sep />) {
  const out = [];
  items.forEach((el, i) => {
    if (i) out.push(<React.Fragment key={`s${i}`}>{sep}</React.Fragment>);
    out.push(el);
  });
  return out;
}

function groupsOf(controls) {
  return [
    { id: 'device', title: 'device', items: controls.device },
    { id: 'slate', title: 'this slate', items: controls.slate },
    { id: 'actions', title: 'actions', items: controls.actions },
  ].filter((g) => g.items.length);
}

/* ---------- row variants ---------- */

function labelText(c) {
  return c.kind === 'action' ? c.label : `${c.label}: ${c.value}`;
}

function GrammarRow({ controls, underline }) {
  const groups = groupsOf(controls);
  return joined(
    groups.map((g) => (
      <React.Fragment key={g.id}>
        {joined(g.items.map((c) => (
          <Ctl key={c.id} c={c}>
            {underline ? <><u className="underline-offset-2 decoration-[var(--theme-text-dim)]">{c.label[0]}</u>{labelText(c).slice(1)}</> : labelText(c)}
          </Ctl>
        )))}
      </React.Fragment>
    )),
    <Bar />
  );
}

function SentenceRow({ controls }) {
  const word = (c) => (
    <Ctl key={c.id} c={c} className="underline decoration-dotted underline-offset-4 decoration-[var(--theme-text-dim)]">
      {c.kind === 'action' ? c.label : c.value}
    </Ctl>
  );
  const dim = { color: 'var(--theme-text-dim)' };
  const phrase = (c) => {
    // noun after the value reads as prose: "dark theme", "counter on"
    if (c.id === 'theme') return <>{word(c)} <span style={dim}>theme</span></>;
    if (c.id === 'size') return <>{word(c)} <span style={dim}>size</span></>;
    if (c.id === 'focus') return <>{word(c)} <span style={dim}>focus</span></>;
    if (c.id === 'editor') return <>{word(c)} <span style={dim}>editor</span></>;
    if (c.kind === 'toggle') return <><span style={dim}>{c.label}</span> {word(c)}</>;
    return word(c);
  };
  const groups = groupsOf(controls);
  return (
    <span className="text-sm whitespace-nowrap">
      {groups.map((g, gi) => (
        <span key={g.id}>
          {gi > 0 && <span style={dim}>. </span>}
          {g.items.map((c, i) => (
            <span key={c.id}>
              {i > 0 && <span style={dim}>, </span>}
              {phrase(c)}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

function StatusLineRow({ controls }) {
  const all = [...controls.device, ...controls.slate, ...controls.actions];
  return joined(all.map((c) => {
    const off = c.kind === 'toggle' && c.value === 'off';
    const shown = c.kind === 'toggle' ? c.label : c.kind === 'action' ? c.label : c.value;
    return (
      <Ctl key={c.id} c={c} className="group" style={off ? { color: 'var(--theme-text-dim)' } : undefined}>
        {c.kind === 'cycle' ? (
          <>
            <span className="hidden group-hover:inline" style={{ color: 'var(--theme-text-dim)' }}>{c.label}: </span>
            {shown}
          </>
        ) : shown}
      </Ctl>
    );
  }));
}

function DotsRow({ controls }) {
  const groups = groupsOf(controls);
  const dim = { color: 'var(--theme-text-dim)' };
  return joined(
    groups.map((g) => (
      <React.Fragment key={g.id}>
        {joined(g.items.map((c) => (
          <Ctl key={c.id} c={c}>
            {c.kind === 'toggle' && <span style={c.value === 'on' ? undefined : dim}>{c.value === 'on' ? '● ' : '○ '}</span>}
            {c.kind === 'toggle' ? c.label : c.kind === 'action' ? c.label : <><span style={dim}>{c.label} ▸ </span>{c.value}</>}
          </Ctl>
        )))}
      </React.Fragment>
    )),
    <Bar />
  );
}

function ChipsRow({ controls }) {
  const all = [...controls.device, ...controls.slate, ...controls.actions];
  return all.map((c) => {
    const on = c.kind === 'toggle' ? c.value === 'on' : c.kind === 'action' ? !!c.active : true;
    return (
      <Ctl
        key={c.id}
        c={c}
        className="h-7 px-3 rounded-full border"
        style={{
          borderColor: 'var(--theme-border)',
          backgroundColor: on && c.kind !== 'cycle' ? 'var(--theme-bg-tertiary)' : 'transparent',
          color: on ? 'var(--theme-text)' : 'var(--theme-text-dim)',
        }}
      >
        {c.kind === 'cycle' ? <><span style={{ color: 'var(--theme-text-dim)' }}>{c.label} </span>{c.value}</> : c.label}
      </Ctl>
    );
  });
}

const SECTION_WORDS = { device: 'look', slate: 'slate', actions: 'share' };

function TabsRow({ controls }) {
  const groups = groupsOf(controls);
  const [open, setOpen] = useState(null);
  const g = groups.find((x) => x.id === open);
  if (g) {
    return (
      <>
        <button onClick={() => setOpen(null)} className={btnBase} style={{ color: 'var(--theme-text-dim)' }} title="back">‹ {SECTION_WORDS[g.id]}</button>
        <Bar />
        {joined(g.items.map((c) => <Ctl key={c.id} c={c}>{labelText(c)}</Ctl>))}
      </>
    );
  }
  return joined(groups.map((x) => (
    <button key={x.id} onClick={() => setOpen(x.id)} className={btnBase} style={{ color: 'var(--theme-accent)' }}>
      {SECTION_WORDS[x.id]}
    </button>
  )));
}

function RevealRow({ controls }) {
  const groups = groupsOf(controls);
  const [open, setOpen] = useState(groups[0]?.id ?? null);
  return joined(groups.map((x) => (
    <span key={x.id} className="flex items-center gap-2" onMouseEnter={() => setOpen(x.id)}>
      <span className="text-sm" style={{ color: open === x.id ? 'var(--theme-text-dim)' : 'var(--theme-accent)' }}>{SECTION_WORDS[x.id]}</span>
      {open === x.id && (
        <span className="flex items-center gap-2 animate-[fadeInFromLeft_0.2s_ease-out]">
          <span className="opacity-30">›</span>
          {joined(x.items.map((c) => <Ctl key={c.id} c={c}>{labelText(c)}</Ctl>))}
        </span>
      )}
    </span>
  )), <Bar />);
}

function PromptRow({ controls, onClose }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const all = [...controls.device, ...controls.slate, ...controls.actions];
  const matches = useMemo(() => {
    const [w0 = '', ...rest] = q.trim().toLowerCase().split(/\s+/);
    const w1 = rest.join(' ');
    return all
      .filter((c) => !w0 || c.label.toLowerCase().startsWith(w0) || c.id.startsWith(w0))
      .map((c) => {
        const target = w1 && c.options?.find((o) => o.startsWith(w1));
        const to = target || nextValue(c);
        return { c, to, text: c.kind === 'action' ? c.label : `${c.label}: ${c.value} → ${to}` };
      })
      .slice(0, 6);
  }, [q, all]);
  useEffect(() => { setSel(0); }, [q]);
  const run = (m) => {
    if (!m) return;
    if (m.c.kind === 'action') m.c.onClick?.({ currentTarget: inputRef.current });
    else if (m.to && m.c.onSet) m.c.onSet(m.to);
    else m.c.onCycle?.();
    setQ('');
    if (m.c.kind === 'action') onClose?.();
  };
  return (
    <div className="relative flex items-center gap-2 text-sm w-full">
      <span style={{ color: 'var(--theme-text-dim)' }}>›</span>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); run(matches[sel]); }
          else if (e.key === 'Escape') { e.preventDefault(); onClose?.(); }
          else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); setSel((s) => (s + matches.length - 1) % matches.length); }
          else if (e.key === 'ArrowDown' || e.key === 'Tab') { e.preventDefault(); setSel((s) => (s + 1) % matches.length); }
        }}
        placeholder="theme sepia, focus, counter off, share…"
        className="bg-transparent outline-none flex-1 min-w-[200px]"
        style={{ color: 'var(--theme-text)' }}
        spellCheck={false}
      />
      {matches.length > 0 && (
        <div
          className="absolute left-0 bottom-full mb-2 rounded shadow-2xl overflow-hidden min-w-[220px] animate-[fadeInUp_0.15s_ease-out]"
          style={{ width: 'max-content', backgroundColor: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border)', zIndex: 200 }}
        >
          {matches.map((m, i) => (
            <button
              key={m.c.id}
              onMouseEnter={() => setSel(i)}
              onClick={() => run(m)}
              className="w-full px-4 py-1.5 text-left text-sm whitespace-nowrap"
              style={{ color: i === sel ? 'var(--theme-text)' : 'var(--theme-text-muted)', backgroundColor: i === sel ? 'var(--theme-bg-tertiary)' : 'transparent' }}
            >
              {m.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- popup variants ---------- */

function Eyebrow({ children }) {
  return <div className="text-[11px] tracking-wider uppercase mb-1" style={{ color: 'var(--theme-text-dim)' }}>{children}</div>;
}

function RowLine({ c }) {
  return (
    <button
      onClick={(e) => fire(c, e)}
      onContextMenu={c.onOpen ? (e) => { e.preventDefault(); c.onOpen(e); } : undefined}
      title={hintFor(c)}
      className={`flex justify-between gap-6 w-full text-left text-sm py-0.5 hover:opacity-70 ${c.pulse ? 'feature-pulse' : ''}`}
      {...(c.id === 'theme' ? { 'data-theme-picker': true } : {})}
    >
      <span style={{ color: c.kind === 'action' ? color(c) : 'var(--theme-text-muted)' }}>{c.label}</span>
      {c.kind !== 'action' && <span style={{ color: c.kind === 'toggle' && c.value === 'off' ? 'var(--theme-text-dim)' : 'var(--theme-accent)' }}>{c.value}</span>}
    </button>
  );
}

function StackPopup({ controls }) {
  const groups = groupsOf(controls);
  return (
    <div className="absolute left-12 bottom-full mb-3 animate-[fadeInUp_0.2s_ease-out] min-w-[220px]" style={{ zIndex: 150 }}>
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <div key={g.id}>
            <Eyebrow>{g.title}</Eyebrow>
            {g.items.map((c) => <RowLine key={c.id} c={c} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function PanelPopup({ controls }) {
  const groups = groupsOf(controls);
  return (
    <div
      className="absolute left-12 bottom-full mb-3 rounded shadow-2xl px-5 py-4 animate-[fadeInUp_0.2s_ease-out] flex gap-8"
      style={{ backgroundColor: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border)', zIndex: 150 }}
    >
      {groups.map((g) => (
        <div key={g.id} className="min-w-[160px]">
          <Eyebrow>{g.title}</Eyebrow>
          {g.items.map((c) => <RowLine key={c.id} c={c} />)}
        </div>
      ))}
    </div>
  );
}

/* ---------- entry ---------- */

function useKeyAccelerators(enabled, controls) {
  useEffect(() => {
    if (!enabled) return;
    const all = [...controls.device, ...controls.slate, ...controls.actions];
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const c = all.find((x) => x.label[0] === e.key);
      if (!c) return;
      e.preventDefault();
      fire(c, { currentTarget: document.querySelector('[data-strip-lab-anchor]') || document.body });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled, controls]);
}

export function StripLab({ variant, controls, rowRef, rowClassName, rowStyle, onRowScroll, onClose }) {
  useKeyAccelerators(variant === 'keys', controls);

  if (variant === 'stack') return <StackPopup controls={controls} />;
  if (variant === 'panel') return <PanelPopup controls={controls} />;

  let body;
  switch (variant) {
    case 'sentence': body = <SentenceRow controls={controls} />; break;
    case 'statusline': body = <StatusLineRow controls={controls} />; break;
    case 'dots': body = <DotsRow controls={controls} />; break;
    case 'chips': body = <ChipsRow controls={controls} />; break;
    case 'keys': body = <GrammarRow controls={controls} underline />; break;
    case 'tabs': body = <TabsRow controls={controls} />; break;
    case 'reveal': body = <RevealRow controls={controls} />; break;
    case 'prompt': body = <PromptRow controls={controls} onClose={onClose} />; break;
    default: body = <GrammarRow controls={controls} />;
  }
  // The prompt's completion list opens upward out of the row, so that variant
  // must not be a scroll container (it would clip the list).
  const cls = variant === 'prompt' ? rowClassName.replace('overflow-x-auto', '') : rowClassName;
  return (
    <div ref={rowRef} className={cls} style={rowStyle} onScroll={onRowScroll} data-strip-lab-anchor>
      {body}
    </div>
  );
}
