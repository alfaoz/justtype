// KaTeX lives in its own lazy chunk (with its stylesheet and fonts) so
// slates without math never download it. livePreview imports this module
// the first time a Math node appears in a document.
import katex from 'katex';
import 'katex/dist/katex.min.css';

// Typeset `tex` into `el`. Display math on its own lines uses KaTeX's
// display mode; `$$` inside a line of prose stays inline but in display
// style so fractions and limits get their full-size layout.
export function renderMath(el, tex, { block, display }) {
  try {
    katex.render(block || !display ? tex : `\\displaystyle ${tex}`, el, {
      displayMode: block,
      throwOnError: true,
      trust: false,
      strict: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}
