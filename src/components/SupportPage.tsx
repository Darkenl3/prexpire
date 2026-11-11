import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, radii, useTheme } from '../theme';
import { SettingRow, SettingsCard, SettingsSection } from './SettingsRows';
import { SearchField } from './SearchField';
import { FadeIn, PressScale } from './Press';
import { FeedbackSheet } from './FeedbackSheet';
import { canOpenLinks, openLink } from '../platform/links';
import { tap } from '../platform/haptics';
import support from '../support.json';

// Settings, About, Help & Support. The same questions and answers as
// prexpire.com/support (both read src/support.json): ways to reach us
// first, then the answers by topic, searchable, each one opening in
// place. Asking a question goes through the same form as Send feedback.

type Question = { q: string; a: string };
type Topic = { id: string; title: string; icon: string; questions: Question[] };
const TOPICS = support.topics as Topic[];
const SITE = 'https://prexpire.com/support';

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function SupportPage({ appVersion }: { appVersion: string }) {
  const s = useStyles();
  const c = useTheme();
  const [query, setQuery] = useState('');
  const [asking, setAsking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const links = canOpenLinks();

  const shown = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return TOPICS;
    return TOPICS.map((t) => ({
      ...t,
      questions: t.questions.filter((x) => {
        const text = fold(`${t.title} ${x.q} ${x.a}`);
        return words.every((w) => text.includes(w));
      }),
    })).filter((t) => t.questions.length > 0);
  }, [query]);
  const searching = query.trim().length > 0;

  return (
    <>
      <SettingsSection title="Get in touch">
        <SettingsCard>
          <SettingRow
            icon="mail-outline"
            accent="blue"
            title="Email us"
            description={support.email}
            onPress={links ? () => openLink(`mailto:${support.email}?subject=${encodeURIComponent(`Prexpire ${appVersion}`)}`) : undefined}
          />
          <SettingRow
            icon="chatbubble-ellipses-outline"
            accent="mint"
            title="Ask a question"
            description="Write to us from here. Add your email to get an answer"
            onPress={() => setAsking(true)}
          />
          {links && <SettingRow icon="globe-outline" accent="teal" title="Open the support website" description="prexpire.com/support" onPress={() => openLink(SITE)} />}
        </SettingsCard>
      </SettingsSection>

      <View style={s.search}>
        <SearchField value={query} onChange={setQuery} placeholder="Search the answers" accessibilityLabel="Search the answers" />
      </View>

      {shown.map((t) => (
        <SettingsSection key={t.id} title={t.title}>
          <SettingsCard>
            {t.questions.map((x, i) => {
              const id = `${t.id}:${x.q}`;
              const expanded = searching || open === id;
              return (
                <View key={id} style={i > 0 && s.line}>
                  <Pressable
                    onPress={() => {
                      tap('light');
                      setOpen(open === id ? null : id);
                    }}
                    disabled={searching}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={x.q}
                    style={({ pressed }) => [s.qRow, pressed && { backgroundColor: c.cardAlt }]}
                  >
                    <Text style={s.q}>{x.q}</Text>
                    {!searching && (
                      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
                    )}
                  </Pressable>
                  {expanded && (
                    <FadeIn style={s.aWrap}>
                      <Text style={s.a} selectable>
                        {x.a}
                      </Text>
                    </FadeIn>
                  )}
                </View>
              );
            })}
          </SettingsCard>
        </SettingsSection>
      ))}

      {searching && shown.length === 0 && (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>No answer matches “{query.trim()}”</Text>
          <Text style={s.emptyText}>Ask us instead, or email support@prexpire.com.</Text>
        </View>
      )}

      <View style={s.ask}>
        <Text style={s.askTitle}>Didn't find your answer?</Text>
        <PressScale onPress={() => setAsking(true)} scaleTo={0.97} accessibilityRole="button" accessibilityLabel="Ask a question" style={s.askBtn}>
          <Text style={s.askBtnText}>Ask a question</Text>
        </PressScale>
      </View>

      <FeedbackSheet visible={asking} onClose={() => setAsking(false)} appVersion={appVersion} initialKind="question" title="Ask a question" />
    </>
  );
}

const useStyles = makeStyles((c) => ({
  search: { marginBottom: 18 },
  line: { borderTopWidth: 1, borderTopColor: c.separator },
  qRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  q: { flex: 1, color: c.text, fontSize: 16, lineHeight: 21, fontWeight: '600' },
  aWrap: { paddingHorizontal: 16, paddingBottom: 16, marginTop: -4 },
  a: { color: c.textBody, fontSize: 15, lineHeight: 22 },
  empty: { paddingHorizontal: 4, paddingVertical: 8, gap: 4, marginBottom: 12 },
  emptyTitle: { color: c.text, fontSize: 16, fontWeight: '700' },
  emptyText: { color: c.textBody, fontSize: 15, lineHeight: 21 },
  ask: { alignItems: 'center', gap: 12, paddingTop: 6, paddingBottom: 12 },
  askTitle: { color: c.textBody, fontSize: 15, fontWeight: '600' },
  askBtn: { minHeight: 50, paddingHorizontal: 26, borderRadius: radii.md, backgroundColor: c.mint, alignItems: 'center', justifyContent: 'center' },
  askBtnText: { color: c.scanInk, fontSize: 16, fontWeight: '800' },
}));
