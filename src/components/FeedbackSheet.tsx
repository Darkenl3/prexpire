import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { PressScale } from './Press';
import { ChoicePill, type PillColors } from './ChoicePill';
import { makeStyles, useTheme } from '../theme';
import { useAuth } from '../auth';
import { tap } from '../platform/haptics';

// Settings, About, Send feedback: a bug report, feedback or an idea, written
// here and sent to the developer (support@prexpire.com) through
// prexpire.com/api/feedback, which keeps every message and emails it on. The
// email is optional; when given, replying to the email reaches the person.

const ENDPOINT = 'https://prexpire.com/api/feedback';
const EMAIL_OK = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

type Kind = 'bug' | 'feedback' | 'idea';
const KINDS: { id: Kind; label: string; send: string; icon: 'bug-outline' | 'chatbubble-ellipses-outline' | 'bulb-outline'; prompt: string }[] = [
  { id: 'bug', label: 'Bug', send: 'Send report', icon: 'bug-outline', prompt: 'What happened, and what did you expect? Steps to repeat it help a lot.' },
  { id: 'feedback', label: 'Feedback', send: 'Send feedback', icon: 'chatbubble-ellipses-outline', prompt: 'What works for you, and what could be better?' },
  { id: 'idea', label: 'Idea', send: 'Send idea', icon: 'bulb-outline', prompt: 'What would you like Prexpire to do?' },
];

export function FeedbackSheet({ visible, onClose, appVersion }: { visible: boolean; onClose: () => void; appVersion: string }) {
  const c = useTheme();
  const s = useStyles();
  const { email: accountEmail } = useAuth();
  const [kind, setKind] = useState<Kind>('bug');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) return;
    setKind('bug');
    setMessage('');
    setEmail(accountEmail ?? '');
    setState('idle');
    setError(null);
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const current = KINDS.find((k) => k.id === kind)!;
  const pills: PillColors = { offBg: c.cardAlt, offBorder: c.surfaceBorder, offText: c.textMuted, onBg: c.mint, onBorder: c.mint, onText: c.scanInk };

  const send = async () => {
    if (state !== 'idle') return;
    const text = message.trim();
    const mail = email.trim();
    if (text.length < 3) return setError('Write a few words first.');
    if (mail && !EMAIL_OK.test(mail)) return setError('That email doesn’t look right. Fix it or leave it empty.');
    setError(null);
    setState('sending');
    tap('light');
    const inApp = typeof window !== 'undefined' && !!(window as { ReactNativeWebView?: unknown }).ReactNativeWebView;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, message: text, email: mail || undefined, appVersion, platform: inApp ? 'iphone-app' : Platform.OS }),
      });
      const out = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !out?.ok) {
        setState('idle');
        return setError(out?.error === 'too-many' ? 'You’ve sent a few already. Try again in an hour.' : 'It couldn’t be sent just now. Try again in a minute.');
      }
      setState('sent');
      tap('success');
      closeTimer.current = setTimeout(onClose, 1400);
    } catch {
      setState('idle');
      setError('You’re offline. Connect to the internet and try again.');
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Send feedback" maxWidth={520}>
      {state === 'sent' ? (
        <View style={s.done}>
          <Ionicons name="checkmark-circle" size={46} color={c.green} />
          <Text style={s.doneTitle}>Thanks, it&apos;s sent</Text>
          <Text style={s.lede}>{mail(email) ? 'We read every message, and we’ll reply by email if needed.' : 'We read every message.'}</Text>
        </View>
      ) : (
        <View style={s.body}>
          <Text style={s.lede}>Found a bug, or have feedback or an idea? It goes straight to the developer.</Text>
          <View style={s.kinds} accessibilityRole={'radiogroup' as never}>
            {KINDS.map((k) => (
              <ChoicePill key={k.id} label={k.label} icon={k.icon} selected={kind === k.id} onPress={() => setKind(k.id)} colors={pills} size="small" />
            ))}
          </View>
          <TextInput
            value={message}
            onChangeText={(v) => {
              setMessage(v);
              if (error) setError(null);
            }}
            placeholder={current.prompt}
            placeholderTextColor={c.textMuted}
            multiline
            maxLength={4000}
            textAlignVertical="top"
            style={[s.input, s.message]}
            accessibilityLabel="Your message"
          />
          <Text style={s.label}>Your email (optional, so we can reply)</Text>
          <TextInput
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              if (error) setError(null);
            }}
            placeholder="you@example.com"
            placeholderTextColor={c.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            style={s.input}
            accessibilityLabel="Your email, optional"
          />
          {error ? <Text style={s.error}>{error}</Text> : null}
          <PressScale onPress={send} scaleTo={0.97} accessibilityRole="button" accessibilityLabel={current.send} style={[s.primary, state === 'sending' && { opacity: 0.7 }]}>
            {state === 'sending' ? <ActivityIndicator color={c.scanInk} /> : <Text style={s.primaryText}>{current.send}</Text>}
          </PressScale>
        </View>
      )}
    </BottomSheet>
  );
}

const mail = (v: string) => EMAIL_OK.test(v.trim());

const useStyles = makeStyles((c) => ({
  body: { gap: 12, paddingTop: 4, paddingBottom: 8 },
  lede: { color: c.textBody, fontSize: 15, lineHeight: 21, textAlign: 'left' },
  kinds: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  label: { color: c.textMuted, fontSize: 13, fontWeight: '600', marginTop: 2 },
  input: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    backgroundColor: c.surface,
    color: c.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  message: { minHeight: 132 },
  error: { color: c.red, fontSize: 14, lineHeight: 19 },
  primary: { height: 54, borderRadius: 16, backgroundColor: c.mint, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryText: { color: c.scanInk, fontSize: 16.5, fontWeight: '800' },
  done: { alignItems: 'center', gap: 8, paddingVertical: 26 },
  doneTitle: { color: c.text, fontSize: 18, fontWeight: '800' },
}));
