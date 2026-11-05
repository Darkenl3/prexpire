import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { PressScale } from './Press';
import { makeStyles, useTheme } from '../theme';
import { MIN_PASSWORD, useAuth, type Outcome } from '../auth';
import { TurnstileFrame } from './TurnstileFrame';

// Signing in, creating an account, and resetting a password, in one sheet.
// Every email carries a 6-digit code the person types here:
//
//   Create account   email + password  -> code ("confirm your email")  -> in
//   Sign in          email + password                                   -> in
//                    (unconfirmed account -> the confirm code step)
//   Forgot password  email -> code -> new password                      -> in
//   Email me a code  email -> code (passwordless, existing accounts)    -> in
//
// Apple and Google sign-in join the top of this sheet in the native build.

const EMAIL_OK = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const RESEND_AFTER = 30;

type Mode = 'signin' | 'signup';
type Step = 'start' | 'code' | 'forgot' | 'newpass' | 'login';
type Purpose = 'signup' | 'reset' | 'login';

type Props = { visible: boolean; onClose: () => void; onSignedIn?: () => void; initialMode?: Mode };

const TITLES: Record<Step, string> = {
  start: '',
  code: 'Check your email',
  forgot: 'Reset your password',
  newpass: 'Choose a new password',
  login: 'Sign in with a code',
};

export function SignInSheet({ visible, onClose, onSignedIn, initialMode = 'signin' }: Props) {
  const c = useTheme();
  const s = useStyles();
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>('start');
  const [purpose, setPurpose] = useState<Purpose>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<TextInput>(null);
  // Turnstile: a token is needed for every request that emails a code or
  // signs in, and each token is spent by one request.
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [captchaBroken, setCaptchaBroken] = useState(false);

  // Every opening starts fresh.
  useEffect(() => {
    if (!visible) return;
    setMode(initialMode);
    setStep('start');
    setPassword('');
    setCode('');
    setError(null);
    setBusy(false);
  }, [visible, initialMode]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const run = async (work: () => Promise<Outcome>): Promise<Outcome> => {
    setBusy(true);
    setError(null);
    const out = await work();
    setBusy(false);
    if (out.error) setError(out.error);
    return out;
  };
  // The same, for requests Turnstile protects: waits for a passed check,
  // spends the token, and asks the widget for the next one.
  const guarded = async (work: (token: string) => Promise<Outcome>): Promise<Outcome | null> => {
    if (!captcha) {
      setError(captchaBroken ? "The security check couldn't load. Check your connection, then try again." : 'One moment: the security check is still running.');
      return null;
    }
    const token = captcha;
    const out = await run(() => work(token));
    setResetKey((k) => k + 1);
    return out;
  };
  const goCode = (p: Purpose) => {
    setPurpose(p);
    setStep('code');
    setCode('');
    setWait(RESEND_AFTER);
    setTimeout(() => codeRef.current?.focus(), 250);
  };
  const done = () => {
    onSignedIn?.();
    onClose();
  };
  const emailOk = () => {
    if (EMAIL_OK.test(email.trim())) return true;
    setError('Enter an email address like name@example.com.');
    return false;
  };

  const submitStart = async () => {
    if (!emailOk()) return;
    if (mode === 'signup') {
      if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
      const out = await guarded((t) => auth.signUp(email, password, t));
      if (!out) return;
      if (!out.error) goCode('signup');
      else if (out.exists) setMode('signin');
      return;
    }
    if (!password) return setError('Enter your password.');
    const out = await guarded((t) => auth.signIn(email, password, t));
    if (!out) return;
    if (!out.error) return done();
    if (out.unconfirmed) {
      // The account exists but was never confirmed: the code step, with a
      // new code one tap away (it needs a fresh security check).
      goCode('signup');
      setWait(0);
      setError("This account isn't confirmed yet. Enter the code from your email, or send a new one.");
    }
  };

  const submitCode = async (value = code) => {
    if (!/^\d{6}$/.test(value)) return setError('Enter the 6-digit code from the email.');
    if (purpose === 'signup') {
      const out = await run(() => auth.confirmSignUp(email, value));
      if (!out.error) done();
    } else if (purpose === 'reset') {
      const out = await run(() => auth.verifyResetCode(email, value));
      if (!out.error) {
        setPassword('');
        setStep('newpass');
      }
    } else {
      const out = await run(() => auth.verifyLoginCode(email, value));
      if (!out.error) done();
    }
  };

  const resend = async () => {
    if (wait > 0 || busy) return;
    const out = await guarded((t) =>
      purpose === 'signup' ? auth.resendConfirmation(email, t) : purpose === 'reset' ? auth.sendResetCode(email, t) : auth.sendLoginCode(email, t),
    );
    if (out && !out.error) setWait(RESEND_AFTER);
  };

  const submitForgot = async () => {
    if (!emailOk()) return;
    const out = await guarded((t) => auth.sendResetCode(email, t));
    if (out && !out.error) goCode('reset');
  };

  const submitLogin = async () => {
    if (!emailOk()) return;
    const out = await guarded((t) => auth.sendLoginCode(email, t));
    if (out && !out.error) goCode('login');
  };

  const submitNewPassword = async () => {
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
    const out = await run(() => auth.setPassword(password));
    if (!out.error) done();
  };

  const clear = () => error && setError(null);

  const emailField = (onSubmit: () => void) => (
    <TextInput
      value={email}
      onChangeText={(v) => {
        setEmail(v);
        clear();
      }}
      onSubmitEditing={onSubmit}
      placeholder="you@example.com"
      placeholderTextColor={c.textMuted}
      keyboardType="email-address"
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="email"
      textContentType={mode === 'signup' ? 'emailAddress' : 'username'}
      inputMode="email"
      returnKeyType="next"
      accessibilityLabel="Email address"
      style={[s.input, error && !password ? s.inputBad : null]}
    />
  );

  const passwordField = (onSubmit: () => void, isNew: boolean) => (
    <View>
      <TextInput
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          clear();
        }}
        onSubmitEditing={onSubmit}
        placeholder={isNew ? `New password, ${MIN_PASSWORD}+ characters` : 'Password'}
        placeholderTextColor={c.textMuted}
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={isNew ? 'new-password' : 'current-password'}
        textContentType={isNew ? 'newPassword' : 'password'}
        returnKeyType="go"
        accessibilityLabel={isNew ? 'New password' : 'Password'}
        style={[s.input, { paddingRight: 52 }]}
      />
      <PressScale
        onPress={() => setShowPassword((v) => !v)}
        scaleTo={0.9}
        accessibilityRole="button"
        accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
        style={s.eye}
      >
        <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={c.textMuted} />
      </PressScale>
    </View>
  );

  const primary = (label: string, onPress: () => void) => (
    <PressScale onPress={busy ? () => {} : onPress} scaleTo={0.97} accessibilityRole="button" accessibilityLabel={label} style={[s.primary, busy && { opacity: 0.7 }]}>
      {busy ? <ActivityIndicator color={c.scanInk} /> : <Text style={s.primaryText}>{label}</Text>}
    </PressScale>
  );

  const link = (label: string, onPress: () => void, strong = false) => (
    <PressScale onPress={onPress} scaleTo={0.97} accessibilityRole="button" accessibilityLabel={label} style={s.linkBtn}>
      <Text style={[s.link, strong && { color: c.green, fontWeight: '700' }]}>{label}</Text>
    </PressScale>
  );

  const errorLine = error ? (
    <Text style={s.error} accessibilityLiveRegion="polite">
      {error}
    </Text>
  ) : null;

  const back = (to: Step) => (
    <PressScale onPress={() => (setError(null), setStep(to))} scaleTo={0.97} accessibilityRole="button" accessibilityLabel="Back" style={[s.linkBtn, { alignSelf: 'flex-start' }]}>
      <Ionicons name="arrow-back" size={15} color={c.textMuted} />
      <Text style={s.link}>Back</Text>
    </PressScale>
  );

  let body: ReactNode;
  if (step === 'start') {
    body = (
      <View style={s.body}>
        <View style={s.tabs} accessibilityRole="tablist">
          {(['signin', 'signup'] as Mode[]).map((m) => (
            <PressScale
              key={m}
              onPress={() => (setMode(m), setError(null))}
              scaleTo={0.98}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === m }}
              style={[s.tab, mode === m && s.tabOn]}
            >
              <Text style={[s.tabText, mode === m && s.tabTextOn]}>{m === 'signin' ? 'Sign in' : 'Create account'}</Text>
            </PressScale>
          ))}
        </View>
        <Text style={s.lede}>
          {mode === 'signup'
            ? "Optional. An account keeps a copy of your items. We'll email you a code to confirm it."
            : 'Your items stay on this phone either way.'}
        </Text>
        {emailField(submitStart)}
        {passwordField(submitStart, mode === 'signup')}
        {errorLine}
        {primary(mode === 'signup' ? 'Create account' : 'Sign in', submitStart)}
        {mode === 'signin' ? (
          <View style={s.row}>
            {link('Forgot password?', () => (setError(null), setStep('forgot')))}
            {link('Email me a code', () => (setError(null), setStep('login')))}
          </View>
        ) : (
          <Text style={s.fine}>By creating an account you agree to the Terms and Privacy Policy.</Text>
        )}
      </View>
    );
  } else if (step === 'code') {
    const what = purpose === 'signup' ? 'to confirm your account' : purpose === 'reset' ? 'to reset your password' : 'to sign in';
    body = (
      <View style={s.body}>
        <Text style={s.lede}>
          Enter the 6-digit code we sent to <Text style={{ color: c.text, fontWeight: '700' }}>{email.trim()}</Text> {what}.
        </Text>
        <TextInput
          ref={codeRef}
          value={code}
          onChangeText={(v) => {
            const digits = v.replace(/\D/g, '').slice(0, 6);
            setCode(digits);
            clear();
            if (digits.length === 6) submitCode(digits);
          }}
          placeholder="000000"
          placeholderTextColor={c.textMuted}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          accessibilityLabel="6-digit code"
          style={[s.input, s.codeInput, error ? s.inputBad : null]}
        />
        {errorLine}
        {primary(purpose === 'reset' ? 'Continue' : purpose === 'signup' ? 'Confirm account' : 'Sign in', () => submitCode())}
        <View style={s.row}>
          {back(purpose === 'reset' ? 'forgot' : purpose === 'login' ? 'login' : 'start')}
          {link(wait > 0 ? `New code in ${wait}s` : 'Send a new code', resend, wait <= 0)}
        </View>
        <Text style={s.fine}>Can't find it? Check your spam folder.</Text>
      </View>
    );
  } else if (step === 'forgot') {
    body = (
      <View style={s.body}>
        <Text style={s.lede}>Enter your account's email. We'll send a code so you can choose a new password.</Text>
        {emailField(submitForgot)}
        {errorLine}
        {primary('Email me a reset code', submitForgot)}
        {back('start')}
      </View>
    );
  } else if (step === 'login') {
    body = (
      <View style={s.body}>
        <Text style={s.lede}>No password needed. We'll email you a code to sign in to your account.</Text>
        {emailField(submitLogin)}
        {errorLine}
        {primary('Email me a code', submitLogin)}
        {back('start')}
      </View>
    );
  } else {
    body = (
      <View style={s.body}>
        <Text style={s.lede}>Code accepted. Choose the new password for {email.trim()}.</Text>
        {passwordField(submitNewPassword, true)}
        {errorLine}
        {primary('Save new password', submitNewPassword)}
      </View>
    );
  }

  const title = step === 'start' ? (mode === 'signup' ? 'Create your account' : 'Sign in') : TITLES[step];
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} scrollable maxWidth={460}>
      {body}
      {/* One widget for the whole sheet, so a passed check carries across
          steps. Not needed once the code is accepted (the new password step). */}
      {visible && step !== 'newpass' ? (
        <TurnstileFrame
          resetKey={resetKey}
          onToken={(t) => {
            setCaptcha(t);
            if (t) setCaptchaBroken(false);
          }}
          onError={() => setCaptchaBroken(true)}
        />
      ) : null}
    </BottomSheet>
  );
}

// Changing the password of the signed-in account (Settings → Account).
export function ChangePasswordSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useTheme();
  const s = useStyles();
  const { setPassword } = useAuth();
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setValue('');
    setError(null);
    setSaved(false);
  }, [visible]);
  const save = async () => {
    if (value.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
    setBusy(true);
    setError(null);
    const out = await setPassword(value);
    setBusy(false);
    if (out.error) return setError(out.error);
    setSaved(true);
    setTimeout(onClose, 900);
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Change password" scrollable={false} maxWidth={460}>
      <View style={s.body}>
        <View>
          <TextInput
            value={value}
            onChangeText={(v) => {
              setValue(v);
              if (error) setError(null);
            }}
            onSubmitEditing={save}
            placeholder={`New password, ${MIN_PASSWORD}+ characters`}
            placeholderTextColor={c.textMuted}
            secureTextEntry={!show}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            accessibilityLabel="New password"
            style={[s.input, { paddingRight: 52 }, error ? s.inputBad : null]}
          />
          <PressScale onPress={() => setShow((v) => !v)} scaleTo={0.9} accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} style={s.eye}>
            <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={c.textMuted} />
          </PressScale>
        </View>
        {error ? <Text style={s.error}>{error}</Text> : null}
        <PressScale onPress={busy || saved ? () => {} : save} scaleTo={0.97} accessibilityRole="button" accessibilityLabel="Save new password" style={[s.primary, busy && { opacity: 0.7 }]}>
          {busy ? <ActivityIndicator color={c.scanInk} /> : <Text style={s.primaryText}>{saved ? 'Password changed' : 'Save new password'}</Text>}
        </PressScale>
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles((c) => ({
  body: { gap: 12, paddingTop: 4, paddingBottom: 8 },
  tabs: { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: c.cardAlt, gap: 4 },
  tab: { flex: 1, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: c.selBg },
  tabText: { color: c.textMuted, fontSize: 14.5, fontWeight: '700' },
  tabTextOn: { color: c.scanInk },
  lede: { color: c.textMuted, fontSize: 15, lineHeight: 21 },
  input: {
    height: 54,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 17,
    color: c.text,
    backgroundColor: c.cardAlt,
    borderWidth: 1.5,
    borderColor: c.surfaceBorder,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  eye: { position: 'absolute', right: 6, top: 7, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  codeInput: { fontSize: 26, letterSpacing: 10, textAlign: 'center', fontWeight: '700' },
  inputBad: { borderColor: c.red },
  error: { color: c.red, fontSize: 14, lineHeight: 19 },
  primary: { height: 54, borderRadius: 16, backgroundColor: c.mint, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: c.scanInk, fontSize: 16.5, fontWeight: '800' },
  fine: { color: c.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 40, paddingHorizontal: 4 },
  link: { color: c.textMuted, fontSize: 14.5 },
}));
