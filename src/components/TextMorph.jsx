import React from 'react';
import { TextMorph as Torph } from 'torph/react';
import { useMotion } from '../motion';

// Every morphing word in the app comes through here, so `motion: off`
// (and the system's reduced-motion preference) makes them all sit still
export function TextMorph(props) {
  const motion = useMotion();
  return <Torph disabled={motion === 'off'} {...props} />;
}
