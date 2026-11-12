import type { Session } from '@supabase/supabase-js';

// Deleting an account that signs in with Apple also revokes Prexpire's access
// to that Apple ID (App Store Review Guideline 5.1.1(v)). The iPhone app shows
// Apple's sheet once more for a fresh one-time code (window.__prexpireAppleRevoke,
// 'apple-revoke-code'), and prexpire.com/api/apple-revoke exchanges and
// revokes it. Best effort: a cancelled sheet, an older app or a failed request
// never stops the deletion itself.

const ENDPOINT = 'https://prexpire.com/api/apple-revoke';

export function signsInWithApple(session: Session | null): boolean {
  const user = session?.user;
  if (!user) return false;
  const providers = (user.app_metadata?.providers as string[] | undefined) ?? [user.app_metadata?.provider as string | undefined];
  return providers.includes('apple') || (user.identities ?? []).some((i) => i.provider === 'apple');
}

type Shell = { postMessage?: (d: string) => void };

function appleCode(): Promise<string | null> {
  const w = typeof window !== 'undefined' ? (window as unknown as { ReactNativeWebView?: Shell; __prexpireAppleRevoke?: number }) : null;
  const shell = w?.ReactNativeWebView;
  if (!w?.__prexpireAppleRevoke || !shell?.postMessage) return Promise.resolve(null);
  const requestId = `revoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    // Apple's sheet waits for the person; give up after two minutes.
    const timer = setTimeout(() => done(null), 120_000);
    const onReply = (e: Event) => {
      const d = (e as CustomEvent<{ requestId?: string; code?: string }>).detail;
      if (!d || d.requestId !== requestId) return;
      done(typeof d.code === 'string' ? d.code : null);
    };
    const done = (code: string | null) => {
      clearTimeout(timer);
      window.removeEventListener('prexpire:apple-revoke-code', onReply);
      resolve(code);
    };
    window.addEventListener('prexpire:apple-revoke-code', onReply);
    try {
      shell.postMessage!(JSON.stringify({ type: 'apple-revoke-code', requestId }));
    } catch {
      done(null);
    }
  });
}

export async function revokeAppleSignIn(): Promise<boolean> {
  try {
    const code = await appleCode();
    if (!code) return false;
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    const out = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return !!out?.ok;
  } catch {
    return false;
  }
}

// True inside an iPhone app build that can get the code (the sheet's note).
export function canRevokeApple(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { __prexpireAppleRevoke?: number }).__prexpireAppleRevoke;
}
