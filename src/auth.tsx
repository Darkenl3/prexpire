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
      signOut,
    }),
    [ready, session, signUp, confirmSignUp, resendConfirmation, signIn, sendResetCode, verifyResetCode, sendLoginCode, verifyLoginCode, setPassword, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth needs <AuthProvider>');
  return ctx;
}
