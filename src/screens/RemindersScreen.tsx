import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { makeStyles } from '../theme';
import { useItems } from '../items';
import { useSettings } from '../settings';
import { reminderDate, reminderLeadLabel, remindersDue, sortItems } from '../preferences';
import { Page } from '../components/Page';
import { ItemRow } from '../components/ItemRow';
import { Note, SmallButton } from '../components/SettingsRows';

type Props = { badge: number; onNavigate: (route: string) => void };

// Reminders worked out from the timing chosen in Settings. They are listed here only:
// the app has no notification delivery yet.
export function RemindersScreen({ badge, onNavigate }: Props) {
  const { items } = useItems();
  const { settings, formatDate } = useSettings();
  const c = useStyles();
  const { due, upcoming } = useMemo(() => {
    const dueList = sortItems(remindersDue(items, settings.reminderLead), 'expiry');
    const dueIds = new Set(dueList.map((i) => i.id));
    return { due: dueList, upcoming: sortItems(items.filter((i) => !dueIds.has(i.id)), 'expiry') };
  }, [items, settings.reminderLead]);

  if (!settings.reminders) {
    return (
      <Page title="Reminders" badge={badge} onNavigate={onNavigate}>
        <View style={c.off}>
          <Text style={c.offTitle}>Expiry reminders are off</Text>
          <Text style={c.offText}>Turn them on in Settings to see which items need a reminder.</Text>
          <SmallButton label="Open Settings" icon="settings-outline" tone="mint" onPress={() => onNavigate('tab:settings')} />
        </View>
      </Page>
    );
  }

  return (
    <Page title="Reminders" subtitle={`Reminders come ${reminderLeadLabel(settings.reminderLead).toLowerCase()}.`} badge={badge} onNavigate={onNavigate}>
      <View style={c.note}>
        <Note>Reminders are listed here. PREXPIRE can't send notifications yet.</Note>
      </View>
      <Text style={c.heading} accessibilityRole="header">
        Due now
      </Text>
      <View style={[c.list, settings.compact && c.listCompact]}>
        {due.map((item) => (
          <ItemRow key={item.id} item={item} showDate />
        ))}
        {due.length === 0 && <Text style={c.empty}>No reminders are due.</Text>}
      </View>
      {upcoming.length > 0 && (
        <>
          <Text style={c.heading} accessibilityRole="header">
            Upcoming
          </Text>
          <View style={[c.list, settings.compact && c.listCompact]}>
            {upcoming.map((item) => (
              <ItemRow key={item.id} item={item} note={`Reminder on ${formatDate(reminderDate(item.expiresOn, settings.reminderLead))}`} />
            ))}
          </View>
        </>
      )}
    </Page>
  );
}

const useStyles = makeStyles((t) => ({
  note: { marginBottom: 6 },
  heading: { color: t.text, fontSize: 19, fontWeight: '700', marginTop: 16, marginBottom: 10 },
  list: { gap: 8 },
  listCompact: { gap: 6 },
  empty: { color: t.textMuted, fontSize: 14, paddingVertical: 8 },
  off: { alignItems: 'center', gap: 8, paddingVertical: 40 },
  offTitle: { color: t.text, fontSize: 17, fontWeight: '600' },
  offText: { color: t.textMuted, fontSize: 14, textAlign: 'center', marginBottom: 6 },
}));
