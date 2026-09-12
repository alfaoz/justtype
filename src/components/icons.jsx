import React from 'react';

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
export const LeaveIcon = (p) => (
  <Icon {...p}><path d="M6.5 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3M10 5l3 3-3 3M13 8H6.5" /></Icon>
);
