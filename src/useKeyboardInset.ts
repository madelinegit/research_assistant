/**
 * How many pixels of the layout viewport are currently covered by the on-screen
 * keyboard. Web-only; returns 0 everywhere else.
 *
 * Why this exists: React Native's <KeyboardAvoidingView> does nothing on web —
 * its `behavior` prop is gated on Platform.OS === 'ios' | 'android', and a web
 * build reports 'web'. On mobile Safari the software keyboard does NOT shrink
 * the layout viewport; it only shrinks the *visual* viewport. So without this,
 * the composer sits behind the keyboard and you type blind.
 *
 * visualViewport.height is the un-obscured area, and offsetTop is how far the
 * visual viewport has been scrolled within the layout viewport, so
 * `innerHeight - height - offsetTop` is exactly the occluded strip at the bottom.
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return; // Pre-iOS 13 / unsupported: degrade to no avoidance.

    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // Ignore sub-pixel noise and the ~0 idle state so we don't thrash layout.
      setInset(covered > 1 ? Math.round(covered) : 0);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
