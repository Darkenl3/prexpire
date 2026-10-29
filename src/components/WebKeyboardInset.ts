import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

// On the web a phone's virtual keyboard never fires React Native's keyboard
// events, so KeyboardAvoidingView alone cannot lift a form clear of it. The
// visual viewport API reports the space the keyboard actually occupies
// (iOS keeps the layout height and shrinks the visual viewport; Android already
// resizes the layout, where this correctly measures ~0). Consumers pad by that
// amount so the form — especially its inputs — always sits above the keys.
// Shared by the scanner screen (the save sheet) and the Shopping List's add
// dialog, so every web form handles the phone keyboard the same way.
type VisualViewportLike = {
  height: number;
  offsetTop: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export function useWebKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const vv = (window as unknown as { visualViewport?: VisualViewportLike }).visualViewport;
    if (!vv) return;
    const measure = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setInset((prev) => (Math.abs(prev - kb) < 1 ? prev : kb));
    };
    measure();
    vv.addEventListener('resize', measure);
    vv.addEventListener('scroll', measure);
    return () => {
      vv.removeEventListener('resize', measure);
      vv.removeEventListener('scroll', measure);
    };
  }, []);
  return inset;
}
