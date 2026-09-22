import { makePref } from './pref';

export const leftyMode = makePref({
  key: 'justtype-lefty', values: ['off', 'on'], fallback: 'off', attr: 'lefty',
});
