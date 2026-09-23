import { flushSync } from 'react-dom';
import { motionOff } from './motion';

// Smooth dismissal for modals and overlays: where the View Transitions API
// exists the state change crossfades (the closing modal fades out instead of
// popping); elsewhere it applies instantly. flushSync makes React commit the
// DOM change inside the transition's snapshot window. Motion off skips it.

export function withViewTransition(apply) {
  if (typeof document !== 'undefined' && document.startViewTransition && !motionOff()) {
    document.startViewTransition(() => {
      flushSync(() => apply());
    });
  } else {
    apply();
  }
}
