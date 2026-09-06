import React from 'react';

/**
 * The writer's settings row: the text controls that open from the three-dot
 * pill. Every state control reads `noun: value`; a cycle or toggle advances
 * on click, a menu control opens its list, actions stay bare verbs. Groups
 * are scoped (device | this slate | actions) and divided the way the header
 * divides its sections.
 *
 * Control model, built in Writer.jsx:
 *   { device: [...], slate: [...], actions: [...] }
 *   control = { id, label, value, options?, kind: 'cycle'|'toggle'|'menu'|'action',
 *               onCycle?, onClick?(e), onOpen?(e), active?, pulse? }
 */

const btnBase = 'transition-colors duration-200 hover:opacity-70 text-sm whitespace-nowrap';
const Sep = () => <span className="opacity-30">·</span>;
const Bar = () => <span className="opacity-30 px-1">|</span>;

// Hover hint naming what the next click does
function hintFor(c) {
  if (c.kind === 'cycle' && c.options?.length) {
    const next = c.options[(c.options.indexOf(c.value) + 1) % c.options.length];
    return `${c.label}: ${c.value} → ${next}`;
  }
  if (c.kind === 'toggle') return `${c.label}: ${c.value} → ${c.value === 'on' ? 'off' : 'on'}`;
  if (c.kind === 'menu') return `${c.label}: ${c.value} · choose`;
  return c.label;
}

export function controlLabel(c) {
  return c.kind === 'action' ? c.label : `${c.label}: ${c.value}`;
}

function joined(items, sep) {
  const out = [];
  items.forEach((el, i) => {
    if (i) out.push(<React.Fragment key={`s${i}`}>{sep}</React.Fragment>);
    out.push(el);
  });
  return out;
}

export function SettingsRow({ controls }) {
  const groups = [controls.device, controls.slate, controls.actions].filter((g) => g.length);
  return joined(
    groups.map((items, gi) => (
      <React.Fragment key={gi}>
        {joined(items.map((c) => (
          <button
            key={c.id}
            onClick={(e) => (c.kind === 'action' ? c.onClick?.(e) : c.kind === 'menu' ? c.onOpen?.(e) : c.onCycle?.(e))}
            title={hintFor(c)}
            className={`${btnBase} ${c.pulse ? 'feature-pulse' : ''}`}
            style={{ color: c.active ? 'rgb(167 139 250)' : 'var(--theme-accent)' }}
            {...(c.id === 'theme' ? { 'data-theme-picker': true } : {})}
          >
            {controlLabel(c)}
          </button>
        )), <Sep />)}
      </React.Fragment>
    )),
    <Bar />
  );
}
