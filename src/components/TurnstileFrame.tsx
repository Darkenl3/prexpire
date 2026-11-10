import { createElement, useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import { useTheme, LIGHT } from '../theme';

// Cloudflare Turnstile for the sign-in sheet. The iPhone app runs this web
// app from a file on the phone, which has no web address, so Turnstile can't
// run in it directly; it runs in public/turnstile.html on app.prexpire.com,
// shown here in a small frame, and hands its token back with postMessage.
// Each token is good for one request: after using it, bump `resetKey`.

export const TURNSTILE_ORIGIN = 'https://app.prexpire.com';

type Props = {
  onToken: (token: string | null) => void;
  resetKey: number;
  onError?: (code: string) => void;
};

export function TurnstileFrame({ onToken, resetKey, onError }: Props) {
  const c = useTheme();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const handlers = useRef({ onToken, onError });
  handlers.current = { onToken, onError };

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== TURNSTILE_ORIGIN) return;
      const data = e.data as { type?: string; token?: string | null; error?: string } | null;
      if (!data || data.type !== 'prexpire-turnstile') return;
      if (data.error) {
        handlers.current.onToken(null);
        handlers.current.onError?.(data.error);
        return;
      }
      handlers.current.onToken(typeof data.token === 'string' && data.token ? data.token : null);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // A used token is spent: ask the widget for a fresh one.
  useEffect(() => {
    if (resetKey === 0) return;
    handlers.current.onToken(null);
    try {
      frame.current?.contentWindow?.postMessage({ type: 'prexpire-turnstile-reset' }, TURNSTILE_ORIGIN);
    } catch {
      // The frame went away; it renders a fresh widget when it comes back.
    }
  }, [resetKey]);

  if (Platform.OS !== 'web') return null;
  const theme = c === LIGHT ? 'light' : 'dark';
  return (
    <View style={{ height: 68, borderRadius: 16, overflow: 'hidden' }} accessibilityLabel="Security check">
      {createElement('iframe', {
        ref: frame,
        src: `${TURNSTILE_ORIGIN}/turnstile.html?theme=${theme}`,
        title: 'Security check',
        style: { width: '100%', height: 68, border: 0, background: 'transparent', colorScheme: theme },
      })}
    </View>
  );
}
