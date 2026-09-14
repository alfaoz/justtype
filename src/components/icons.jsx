import React from 'react';
import { useIcons } from '../iconsPref';

/**
 * The few line icons the app draws itself: 16 on a side, 1.5 stroke, the
 * text's colour. Each takes a className for size and tone.
 */
const Icon = ({ className = 'w-4 h-4', children, ...rest }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {children}
  </svg>
);

export const PinIcon = (p) => (
  <Icon {...p}><path d="M9.5 2.5l4 4-1.5 1.5-.5-.5-3 3 .5 3-1 1L5 11.5l-3 3v-1l3-3-3-3 1-1 3 .5 3-3-.5-.5z" /></Icon>
);
export const UnpinIcon = (p) => (
  <Icon {...p}><path d="M9.5 2.5l4 4-1.5 1.5-.5-.5-3 3 .5 3-1 1L5 11.5l-3 3v-1l3-3-3-3 1-1 3 .5 3-3-.5-.5z" /><path d="M2 2l12 12" /></Icon>
);
export const TagIcon = (p) => (
  <Icon {...p}><path d="M2 2h5.5L14 8.5 8.5 14 2 7.5z" /><circle cx="5" cy="5" r=".75" fill="currentColor" /></Icon>
);
export const CloudDownIcon = (p) => (
  <Icon {...p}><path d="M4.5 12.5A3 3 0 0 1 4 6.6 4.5 4.5 0 0 1 12.7 7.5 2.5 2.5 0 0 1 12 12.5H4.5z" /><path d="M8 7v5m-2-2 2 2 2-2" /></Icon>
);
export const CloudOffIcon = (p) => (
  <Icon {...p}><path d="M4.5 12.5A3 3 0 0 1 4 6.6 4.5 4.5 0 0 1 12.7 7.5 2.5 2.5 0 0 1 12 12.5H4.5z" /><path d="M2.5 2.5l11 11" /></Icon>
);
export const GlobeIcon = (p) => (
  <Icon {...p}><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" /></Icon>
);
export const EyeOffIcon = (p) => (
  <Icon {...p}><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" /><circle cx="8" cy="8" r="1.75" /><path d="M2.5 2.5l11 11" /></Icon>
);
export const LockIcon = (p) => (
  <Icon {...p}><rect x="3.5" y="7" width="9" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></Icon>
);
export const UnlockIcon = (p) => (
  <Icon {...p}><rect x="3.5" y="7" width="9" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 4.6-1.3" /></Icon>
);
export const ArchiveIcon = (p) => (
  <Icon {...p}><rect x="2" y="3" width="12" height="3" rx=".75" /><path d="M3 6v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M6.5 9h3" /></Icon>
);
export const UnarchiveIcon = (p) => (
  <Icon {...p}><rect x="2" y="3" width="12" height="3" rx=".75" /><path d="M3 6v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M8 12.5V8.5m-1.75 1.75L8 8.5l1.75 1.75" /></Icon>
);
export const TrashIcon = (p) => (
  <Icon {...p}><path d="M2.5 4.5h11M6 4.5V3h4v1.5M3.5 4.5l.7 8.5a1 1 0 0 0 1 .9h5.6a1 1 0 0 0 1-.9l.7-8.5M6.5 7v4M9.5 7v4" /></Icon>
);
export const ArrowUpIcon = (p) => (
  <Icon {...p}><path d="M8 13V3m-4 4 4-4 4 4" /></Icon>
);
export const ArrowDownIcon = (p) => (
  <Icon {...p}><path d="M8 3v10m-4-4 4 4 4-4" /></Icon>
);
export const PenIcon = (p) => (
  <Icon {...p}><path d="M11.5 2.5l2 2L5 13H3v-2z" /><path d="M10 4l2 2" /></Icon>
);
export const UserIcon = (p) => (
  <Icon {...p}><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" /></Icon>
);
export const SunIcon = (p) => (
  <Icon {...p}><circle cx="8" cy="8" r="2.75" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3m10 0h1.5M3.4 3.4l1 1m7.2 7.2 1 1M3.4 12.6l1-1m7.2-7.2 1-1" /></Icon>
);
export const SizeIcon = (p) => (
  <Icon {...p}><path d="M2 13l3.5-9 3.5 9M3.3 10h4.4" /><path d="M10 13l2-5 2 5m-3.3-1.8h2.6" /></Icon>
);
export const EyeIcon = (p) => (
  <Icon {...p}><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" /><circle cx="8" cy="8" r="1.75" /></Icon>
);
export const HashIcon = (p) => (
  <Icon {...p}><path d="M6 2.5 4.5 13.5M11.5 2.5 10 13.5M2.5 6h11M2 10.5h11" /></Icon>
);
export const PeopleIcon = (p) => (
  <Icon {...p}><circle cx="6" cy="5.5" r="2.25" /><path d="M1.5 13c0-2.3 2-3.75 4.5-3.75S10.5 10.7 10.5 13" /><path d="M10.5 3.5a2.25 2.25 0 0 1 0 4.2M12 9.6c1.5.5 2.5 1.8 2.5 3.4" /></Icon>
);
export const ClockIcon = (p) => (
  <Icon {...p}><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></Icon>
);
export const LinkIcon = (p) => (
  <Icon {...p}><path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-1 1" /><path d="M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l1-1" /></Icon>
);
export const ImportIcon = (p) => (
  <Icon {...p}><path d="M8 2v8m-3-3 3 3 3-3" /><path d="M2.5 11v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" /></Icon>
);
export const SelectIcon = (p) => (
  <Icon {...p}><circle cx="8" cy="8" r="6" /><path d="M5.25 8.25l1.9 1.9 3.6-4.1" /></Icon>
);
export const SortIcon = (p) => (
  <Icon {...p}><path d="M5 3v10m-2.5-2.5L5 13l2.5-2.5" /><path d="M11 13V3m-2.5 2.5L11 3l2.5 2.5" /></Icon>
);
export const LeaveIcon = (p) => (
  <Icon {...p}><path d="M6.5 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3M10 5l3 3-3 3M13 8H6.5" /></Icon>
);

/** A glyph that is only there when the device wants icons */
export function Ico({ of: Glyph, className }) {
  return useIcons() === 'on' ? <Glyph className={className} /> : null;
}
