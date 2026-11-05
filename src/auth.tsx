import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type Session } from '@supabase/supabase-js';

// Accounts (optional). Prexpire works fully without one; signing in is for
// people who want their list backed up and, later, synced across phones.
//
// Every email the person receives carries a 6-digit CODE they type into the
// app (Supabase's email templates use {{ .Token }}): confirming a new account,
// resetting a password, and passwordless sign-in. A link in an email would
// open Safari, not the app, so codes keep the whole flow inside Prexpire.
//
// The session is kept with AsyncStorage next to the items, so it survives
// restarts and works offline; it refreshes itself when online.
//
// The publishable key is meant to ship in apps: what anyone may read or
// write is decided by Row Level Security on each table, not by this key.

export const SUPABASE_URL = 'https://whzvmflojzrcorfoqipl.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bmvmL7EXhHcy2HvbpafP2g_ktaE60ws';
export const MIN_PASSWORD = 8;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: AsyncStorage,
    storageKey: 'prexpire.auth.v1',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// Each call resolves with a sentence for the person when something went
// wrong, or null when it worked. `unconfirmed` marks a sign-in to an account
// whose email was never confirmed, so the sheet can go straight to the code.
export type Outcome = { error: string | null; unconfirmed?: boolean; exists?: boolean };

type AuthContext = {
  ready: boolean;
  session: Session | null;
  email: string | null;
  signUp: (email: string, password: string, captchaToken?: string) => Promise<Outcome>;
  confirmSignUp: (email: string, code: string) => Promise<Outcome>;
  resendConfirmation: (email: string, captchaToken?: string) => Promise<Outcome>;
  signIn: (email: string, password: string, captchaToken?: string) => Promise<Outcome>;
  sendResetCode: (email: string, captchaToken?: string) => Promise<Outcome>;
  verifyResetCode: (email: string, code: string) => Promise<Outcome>;
  sendLoginCode: (email: string, captchaToken?: string) => Promise<Outcome>;
  verifyLoginCode: (email: string, code: string) => Promise<Outcome>;
  setPassword: (password: string) => Promise<Outcome>;
  // Resolves with error null on success, 'canceled' when the person closed
  // Apple's sheet (no message needed), or a sentence.
  signInWithApple: () => Promise<Outcome>;
  signInWithGoogle: () => Promise<Outcome>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthContext | null>(null);

type SupaError = { code?: string; message?: string; status?: number } | null | undefined;

// Supabase's error codes, said in the app's voice: what happened, what to do.
export function explain(error: SupaError): string | null {
  if (!error) return null;
  const code = error.code ?? '';
  const msg = (error.message ?? '').toLowerCase();
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || error.status === 429 || msg.includes('rate limit'))
    return 'Too many emails were sent. Wait a few minutes, then try again.';
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return "That email and password don't match. Check them, or reset your password.";
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) return 'Confirm your email first. Enter the code we sent you.';
  if (code === 'user_already_exists' || code === 'email_exists' || msg.includes('already registered')) return 'An account with this email already exists. Sign in instead.';
  if (code === 'weak_password' || msg.includes('password should')) return `Choose a stronger password: at least ${MIN_PASSWORD} characters, not a common one.`;
  if (code === 'same_password' || msg.includes('different from the old')) return 'Choose a password different from your current one.';
  if (code === 'otp_expired' || msg.includes('token has expired') || msg.includes('otp') || msg.includes('invalid token'))
    return "That code isn't right or has expired. Check it, or send a new one.";
  if (code === 'email_address_invalid' || msg.includes('invalid email') || msg.includes('validate email'))
    return "That email address doesn't look right. Check it and try again.";
  if (code === 'captcha_failed' || msg.includes('captcha')) return 'The security check failed. Try again.';
  if (code === 'signup_disabled') return 'New accounts are paused right now. Try again later.';
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('failed to')) return "You're offline. Connect to the internet to continue.";
  return "That didn't work just now. Try again in a minute.";
}

const norm = (email: string) => email.trim().toLowerCase();

// Sign in with Apple is native: only an iPhone app build that has it sets
// this flag (older builds don't, so the button never shows where it can't work).
export function appleSignInAvailable(): boolean {
  return typeof window !== 'undefined' && !!(window as { __prexpireAppleSignIn?: unknown }).__prexpireAppleSignIn && !!(window as { ReactNativeWebView?: unknown }).ReactNativeWebView;
}

// SHA-256 as hex, in plain JS (the page runs from a file inside the app, where
// crypto.subtle isn't guaranteed). Apple gets the hash of the nonce; Supabase
// gets the raw nonce and checks they match.
function sha256Hex(text: string): string {
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = Array.from(unescape(encodeURIComponent(text)), (ch) => ch.charCodeAt(0));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + k[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
  return h.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

function randomNonce(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Sign in with Google is native too; the flag is set only by app builds that
// have it configured.
export function googleSignInAvailable(): boolean {
  return typeof window !== 'undefined' && !!(window as { __prexpireGoogleSignIn?: unknown }).__prexpireGoogleSignIn && !!(window as { ReactNativeWebView?: unknown }).ReactNativeWebView;
}

// Asks the iPhone app for a native sign-in sheet (Apple's or Google's) and
// waits for the identity token it sends back.
async function nativeIdToken(provider: 'apple' | 'google', extra: Record<string, string> = {}): Promise<{ token?: string; error?: string }> {
  const shell = (window as { ReactNativeWebView?: { postMessage?: (d: string) => void } }).ReactNativeWebView;
  if (!shell?.postMessage) return { error: 'failed' };
  const requestId = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const event = `prexpire:${provider}-signin`;
  return new Promise((resolve) => {
    const onReply = (e: Event) => {
      const d = (e as CustomEvent<{ requestId?: string; token?: string; error?: string }>).detail;
      if (!d || d.requestId !== requestId) return;
      window.removeEventListener(event, onReply);
      resolve({ token: d.token, error: d.error });
    };
    window.addEventListener(event, onReply);
    shell.postMessage!(JSON.stringify({ type: `${provider}-signin`, requestId, ...extra }));
  });
}
const fail = (e: unknown): Outcome => ({ error: explain({ message: String(e) }) });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth
      .getSession()
      .then(({ data }) => alive && setSession(data.session))
      .catch(() => {})
      .finally(() => alive && setReady(true));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (email: string, password: string, captchaToken?: string): Promise<Outcome> => {
    try {
      const { data, error } = await supabase.auth.signUp({ email: norm(email), password, options: { captchaToken } });
      if (error) return { error: explain(error), exists: error.code === 'user_already_exists' };
      // Supabase hides whether an address is taken: an existing, confirmed
      // account comes back as a user with no identities and no email is sent.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
        return { error: 'An account with this email already exists. Sign in instead.', exists: true };
      return { error: null };
    } catch (e) {
      return fail(e);
    }
  }, []);

  const confirmSignUp = useCallback(async (email: string, code: string): Promise<Outcome> => {
    try {
      const { error } = await supabase.auth.verifyOtp({ email: norm(email), token: code, type: 'signup' });
      if (!error) return { error: null };
      // A code sent by "resend" or one typed after a password sign-in may be
      // an email-type token; try that before giving up.
      const second = await supabase.auth.verifyOtp({ email: norm(email), token: code, type: 'email' });
      return { error: explain(second.error) };
    } catch (e) {
      return fail(e);
    }
  }, []);

  const resendConfirmation = useCallback(async (email: string, captchaToken?: string): Promise<Outcome> => {
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: norm(email), options: { captchaToken } });
      return { error: explain(error) };
    } catch (e) {
      return fail(e);
    }
  }, []);

  const signIn = useCallback(async (email: string, password: string, captchaToken?: string): Promise<Outcome> => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: norm(email), password, options: { captchaToken } });
      if (error && (error.code === 'email_not_confirmed' || /not confirmed/i.test(error.message))) return { error: explain(error), unconfirmed: true };
      return { error: explain(error) };
    } catch (e) {
      return fail(e);
    }
  }, []);

  const sendResetCode = useCallback(async (email: string, captchaToken?: string): Promise<Outcome> => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(norm(email), { captchaToken });
      return { error: explain(error) };
    } catch (e) {
      return fail(e);
    }
  }, []);

  const verifyResetCode = useCallback(async (email: string, code: string): Promise<Outcome> => {
    try {
      const { error } = await supabase.auth.verifyOtp({ email: norm(email), token: code, type: 'recovery' });
      return { error: explain(error) };
    } catch (e) {
      return fail(e);
    }
  }, []);

  const sendLoginCode = useCallback(async (email: string, captchaToken?: string): Promise<Outcome> => {
    try {
      // Passwordless sign-in for an EXISTING account only; new accounts are
      // created with a password and confirmed with their own code.
      const { error } = await supabase.auth.signInWithOtp({ email: norm(email), options: { shouldCreateUser: false, captchaToken } });
      if (error && (error.code === 'otp_disabled' || /signups not allowed|user not found/i.test(error.message)))
        return { error: 'There is no account with this email yet. Create one instead.' };
      return { error: explain(error) };
    } catch (e) {
      return fail(e);
    }
  }, []);

  const verifyLoginCode = useCallback(async (email: string, code: string): Promise<Outcome> => {
    try {
      const { error } = await supabase.auth.verifyOtp({ email: norm(email), token: code, type: 'email' });
      return { error: explain(error) };
    } catch (e) {
      return fail(e);
    }
  }, []);

  const setPassword = useCallback(async (password: string): Promise<Outcome> => {
    try {
      const { error } = await supabase.auth.updateUser({ password });
      return { error: explain(error) };
    } catch (e) {
      return fail(e);
    }
  }, []);

  const signInWithApple = useCallback(async (): Promise<Outcome> => {
    try {
      const raw = randomNonce();
      const apple = await nativeIdToken('apple', { nonce: sha256Hex(raw) });
      if (apple.error === 'canceled') return { error: 'canceled' };
      if (!apple.token) return { error: "Sign in with Apple didn't work. Try again, or use your email." };
      const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: apple.token, nonce: raw });
      return { error: explain(error) };
    } catch (e) {
      return fail(e);
    }
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<Outcome> => {
    try {
      const google = await nativeIdToken('google');
      if (google.error === 'canceled') return { error: 'canceled' };
      if (!google.token) return { error: "Sign in with Google didn't work. Try again, or use your email." };
      const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: google.token });
      return { error: explain(error) };
    } catch (e) {
      return fail(e);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Offline: the local session is cleared anyway.
    }
    setSession(null);
  }, []);

  const value = useMemo<AuthContext>(
    () => ({
      ready,
      session,
      email: session?.user?.email ?? null,
      signUp,
      confirmSignUp,
      resendConfirmation,
      signIn,
      sendResetCode,
      verifyResetCode,
      sendLoginCode,
      verifyLoginCode,
      setPassword,
      signInWithApple,
      signInWithGoogle,
      signOut,
    }),
    [ready, session, signUp, confirmSignUp, resendConfirmation, signIn, sendResetCode, verifyResetCode, sendLoginCode, verifyLoginCode, setPassword, signInWithApple, signInWithGoogle, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth needs <AuthProvider>');
  return ctx;
}
