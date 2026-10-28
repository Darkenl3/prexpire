import { useCallback, useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { makeStyles, useTheme, accents } from '../theme';
import { useItems } from '../items';
import { useCategories } from '../categories';
import { useSettings } from '../settings';
import {
  DATE_FORMAT_LABELS,
  DATE_FORMATS,
  exportFileName,
  itemsToJson,
  itemsToCsv,
  REMINDER_LEADS,
  reminderLeadLabel,
  SORT_LABELS,
  SORT_ORDERS,
  THEME_LABELS,
  THEME_MODES,
  WARNING_DAYS,
  type DefaultCategory,
} from '../preferences';
import { isoToday } from '../scanner/dateParser';
import { Page } from '../components/Page';
import { Brandmark } from '../components/HomeComponents';
import { CategoryManager } from '../components/CategoryManager';
import { IconTile, Note, Options, SettingRow, SettingsCard, SettingsSection, SmallButton, Toggle } from '../components/SettingsRows';
import { notificationStatus, requestNotificationPermission, watchNotificationStatus, type NotificationStatus } from '../platform/notifications';
import { saveTextFile } from '../platform/saveFile';
import appConfig from '../../app.json';

const APP_VERSION: string = appConfig.expo.version;
const WEB = Platform.OS === 'web';

type Props = { badge: number; onNavigate: (route: string) => void };

export function SettingsScreen({ badge, onNavigate }: Props) {
  const t = useTheme();
  const s = useStyles();
  const { settings, update, saveError, systemReduceMotion, formatDate, reset } = useSettings();
  const { saved, clearSaved } = useItems();
  const { all, clearAll: clearCategories } = useCategories();
  const [confirmClear, setConfirmClear] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportAs = async (kind: 'json' | 'csv') => {
    setExportError(null);
    const now = new Date();
    try {
      if (kind === 'json') await saveTextFile(exportFileName('json', now), 'application/json', itemsToJson(saved, now, APP_VERSION));
      else {
        // Custom categories export with their own names.
        const names: Record<string, string> = {};
        for (const cat of all) names[cat.id] = cat.name;
        await saveTextFile(exportFileName('csv', now), 'text/csv', itemsToCsv(saved, names));
      }
    } catch {
      setExportError('The file could not be created. Your browser may be blocking downloads on this page.');
    }
  };

  return (
    <Page title="Settings" subtitle="Make PREXPIRE work for you." badge={badge} onNavigate={onNavigate}>
      {saveError && (
        <View style={s.banner} accessibilityRole="alert">
          <Note tone="warn">Your last change couldn't be saved in this browser's storage. It applies until you close the page.</Note>
        </View>
      )}

      <View style={s.profile}>
        <IconTile icon="person" accent="mint" size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.profileTitle}>Your preferences</Text>
          <Text style={s.profileSub}>
            {WEB ? 'Saved in this browser' : 'Saved on this device'}. No account needed.
          </Text>
        </View>
        <View style={s.profileStat}>
          <Text style={s.profileCount}>{saved.length}</Text>
          <Text style={s.profileCountLabel}>{saved.length === 1 ? 'item added' : 'items added'}</Text>
        </View>
      </View>

      <SettingsSection title="Notifications">
        <SettingsCard>
          <SettingRow
            icon="notifications"
            accent="amber"
            title="Expiry reminders"
            description="Get notified before items expire."
            right={<Toggle label="Expiry reminders" value={settings.reminders} onChange={(v) => update({ reminders: v })} />}
            below={
              <Note>
                {settings.reminders
                  ? 'Due reminders appear in the Reminders tab and its badge. PREXPIRE does not send notifications yet.'
                  : 'Off. The Reminders tab lists nothing and its badge stays clear.'}
              </Note>
            }
          />
          <SettingRow
            icon="time"
            accent="amber"
            title="Reminder timing"
            description="Choose when reminders arrive."
            below={
              <Options
                label="Reminder timing"
                value={settings.reminderLead}
                onChange={(v) => update({ reminderLead: v })}
                options={REMINDER_LEADS.map((l) => ({ value: l, label: reminderLeadLabel(l), disabled: !settings.reminders }))}
              />
            }
          />
          <SettingRow
            icon="today"
            accent="amber"
            title="Daily summary"
            description="See what's expiring soon."
            right={<Toggle label="Daily summary" value={settings.dailySummary} onChange={(v) => update({ dailySummary: v })} />}
            below={settings.dailySummary ? <Note>Saved. A daily summary needs notification delivery, which isn't built yet, so none is sent.</Note> : undefined}
          />
          <BrowserNotificationsRow />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Appearance">
        <SettingsCard>
          <SettingRow
            icon="contrast"
            accent="purple"
            title="Theme"
            description="Dark, light, or follow your device."
            below={
              <>
                <Options
                  label="Theme"
                  value={settings.theme}
                  onChange={(v) => update({ theme: v })}
                  options={THEME_MODES.map((m) => ({ value: m, label: THEME_LABELS[m] }))}
                />
                <Note>
                  {settings.theme === 'system'
                    ? 'System follows your device\u2019s appearance and switches live.'
                    : settings.theme === 'light'
                      ? 'A bright take on the same design.'
                      : 'The classic near-black look.'}
                </Note>
              </>
            }
          />
          <SettingRow
            icon="reorder-four"
            accent="blue"
            title="Compact layout"
            description="Shorter rows in item lists."
            right={<Toggle label="Compact layout" value={settings.compact} onChange={(v) => update({ compact: v })} />}
          />
          <SettingRow
            icon="sparkles"
            accent="purple"
            title="Animations"
            description="Fades and the scanner's sweep line."
            right={
              <Toggle
                label="Animations"
                value={settings.animations && !systemReduceMotion}
                disabled={systemReduceMotion}
                onChange={(v) => update({ animations: v })}
              />
            }
            below={systemReduceMotion ? <Note>Your device asks for reduced motion, so animations stay off.</Note> : undefined}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Expiry preferences">
        <SettingsCard>
          <SettingRow
            icon="hourglass"
            accent="mint"
            title="Default warning period"
            description="Items count as expiring soon this far ahead."
            below={
              <Options
                label="Default warning period"
                value={settings.warningDays}
                onChange={(v) => update({ warningDays: v })}
                options={WARNING_DAYS.map((d) => ({ value: d, label: `${d} days` }))}
              />
            }
          />
          <SettingRow
            icon="calendar"
            accent="mint"
            title="Date format"
            description={`Today shows as ${formatDate(isoToday(new Date()))}.`}
            below={
              <Options
                label="Date format"
                value={settings.dateFormat}
                onChange={(v) => update({ dateFormat: v })}
                options={DATE_FORMATS.map((f) => ({ value: f, label: DATE_FORMAT_LABELS[f] }))}
              />
            }
          />
          <SettingRow
            icon="swap-vertical"
            accent="mint"
            title="Default sorting"
            description="Order of the Items list."
            below={
              <Options
                label="Default sorting"
                value={settings.sort}
                onChange={(v) => update({ sort: v })}
                options={SORT_ORDERS.map((o) => ({ value: o, label: SORT_LABELS[o] }))}
              />
            }
          />
          <SettingRow
            icon="eye"
            accent="mint"
            title="Show expired items"
            description="Keep expired items in the Home and Items lists."
            right={<Toggle label="Show expired items" value={settings.showExpired} onChange={(v) => update({ showExpired: v })} />}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Categories and inventory">
        <SettingsCard>
          <SettingRow
            icon="grid"
            accent="blue"
            title="Browse categories"
            description="Food, Medicine, Household, Skincare, Pantry and the ones you add."
            onPress={() => onNavigate('tab:items')}
          />
          <SettingRow
            icon="folder-open-outline"
            accent="blue"
            title="Your categories"
            description="Add a category folder and it appears on Home, in lists and in the scanner."
            below={<CategoryManager />}
          />
          <SettingRow
            icon="pricetag"
            accent="blue"
            title="Default category"
            description="Preselected when you add an item."
            below={
              <Options<DefaultCategory>
                label="Default category"
                value={settings.defaultCategory}
                onChange={(v) => update({ defaultCategory: v })}
                options={[{ value: 'last', label: 'Last used' }, ...all.map((cat) => ({ value: cat.id as DefaultCategory, label: cat.name }))]}
              />
            }
          />
          <SettingRow
            icon="flask"
            accent="blue"
            title="Show sample items"
            description="The example items Oat milk, Ibuprofen and Bread."
            right={<Toggle label="Show sample items" value={settings.showSamples} onChange={(v) => update({ showSamples: v })} />}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Privacy and data">
        <SettingsCard>
          <SettingRow
            icon="camera"
            accent="teal"
            title="Camera access"
            description={
              WEB
                ? "The scanner asks your browser for the camera when you open it. Frames are read in the browser and never uploaded. To change access, use your browser's site settings."
                : 'The scanner asks for the camera when you open it. Frames are read on the device and never uploaded. To change access, use the Settings app.'
            }
            below={<SmallButton label="Open scanner" icon="scan-outline" onPress={() => onNavigate('scan')} />}
          />
          <SettingRow
            icon="server"
            accent="teal"
            title="Data storage"
            description={
              WEB
                ? "Items, categories and settings are stored only in this browser's local storage, on this device. Nothing is uploaded, synced or backed up, and clearing your browser data removes them."
                : 'Items, categories and settings are stored only on this device. Nothing is uploaded, synced or backed up.'
            }
          />
          <SettingRow
            icon="download"
            accent="teal"
            title="Export data"
            description={saved.length ? `Download your ${saved.length} added ${saved.length === 1 ? 'item' : 'items'}: name, category, expiry date, date precision, when added and source.` : 'Nothing to export yet. Items you add will be exported here (sample items are not included).'}
            below={
              <>
                <View style={s.buttons}>
                  <SmallButton label="JSON" icon="code-slash" disabled={!saved.length} onPress={() => exportAs('json')} accessibilityLabel="Export items as JSON" />
                  <SmallButton label="CSV" icon="document-text" disabled={!saved.length} onPress={() => exportAs('csv')} accessibilityLabel="Export items as CSV" />
                </View>
                {exportError && <Note tone="warn">{exportError}</Note>}
              </>
            }
          />
        </SettingsCard>
        <View style={{ height: 12 }} />
        <SettingsCard danger>
          <SettingRow
            icon="trash"
            accent="red"
            title="Clear all data"
            titleColor={accents.red}
            description="Delete your added items and categories, and reset every setting."
            onPress={() => setConfirmClear(true)}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="About">
        <SettingsCard>
          <View style={s.about}>
            <Brandmark height={44} />
            <Text style={s.aboutText}>Keep track of what matters before it expires.</Text>
            <Text style={s.aboutVersion}>Version {APP_VERSION}</Text>
          </View>
        </SettingsCard>
      </SettingsSection>

      <ClearDataDialog
        visible={confirmClear}
        itemCount={saved.length}
        categoryCount={all.filter((cat) => cat.custom).length}
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          await clearSaved();
          await clearCategories();
          await reset();
          setConfirmClear(false);
        }}
      />
    </Page>
  );
}

function BrowserNotificationsRow() {
  const t = useTheme();
  const s = useStyles();
  const [status, setStatus] = useState<NotificationStatus>(notificationStatus);
  const [asking, setAsking] = useState(false);
  const refresh = useCallback(() => setStatus(notificationStatus()), []);
  useEffect(() => watchNotificationStatus(refresh), [refresh]);

  const ask = async () => {
    setAsking(true);
    setStatus(await requestNotificationPermission());
    setAsking(false);
  };

  const label: Record<NotificationStatus, string> = {
    granted: 'Allowed',
    denied: 'Blocked',
    default: 'Not set',
    unsupported: 'Unavailable',
    insecure: 'Unavailable',
  };
  const note: Record<NotificationStatus, { text: string; tone: 'ok' | 'warn' | 'muted' }> = {
    granted: { text: 'This browser allows PREXPIRE to show notifications. None are sent yet, because reminder delivery is not built.', tone: 'ok' },
    denied: { text: "Notifications are blocked for this site. To allow them, change the site's notification setting in your browser, then come back.", tone: 'warn' },
    default: { text: 'Your browser will ask for permission when you select Allow. Nothing is sent yet; this only prepares the browser.', tone: 'muted' },
    unsupported: { text: WEB ? "This browser doesn't support web notifications." : 'Notifications are not set up in this version of the app.', tone: 'muted' },
    insecure: { text: 'Browsers only allow notifications on secure (https) pages.', tone: 'muted' },
  };

  return (
    <SettingRow
      icon="globe"
      accent="amber"
      title={WEB ? 'Browser notifications' : 'Notifications'}
      description={WEB ? 'Allow notifications from this browser.' : 'Allow notifications on this device.'}
      right={
        <View style={[s.status, status === 'granted' && { borderColor: t.statusOkBorder, backgroundColor: t.statusOkBg }, status === 'denied' && { borderColor: t.statusWarnBorder, backgroundColor: t.statusWarnBg }]} accessibilityLabel={`Permission: ${label[status]}`}>
          <Text style={[s.statusText, status === 'granted' && { color: t.mint }, status === 'denied' && { color: t.amberText }]}>{label[status]}</Text>
        </View>
      }
      below={
        <>
          <Note tone={note[status].tone}>{note[status].text}</Note>
          {status === 'default' && (
            <View style={s.buttons}>
              <SmallButton label={asking ? 'Waiting for browser…' : 'Allow notifications'} icon="notifications-outline" tone="mint" disabled={asking} onPress={ask} />
            </View>
          )}
        </>
      }
    />
  );
}

type DialogProps = { visible: boolean; itemCount: number; categoryCount: number; onCancel: () => void; onConfirm: () => Promise<void> };

function ClearDataDialog({ visible, itemCount, categoryCount, onCancel, onConfirm }: DialogProps) {
  const t = useTheme();
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (visible) setError(false);
  }, [visible]);

  const confirm = async () => {
    setBusy(true);
    setError(false);
    try {
      await onConfirm();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? () => {} : onCancel}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onCancel} accessibilityLabel="Close" importantForAccessibility="no" />
        <View style={[s.dialog, { backgroundColor: t.dialogBg, borderColor: t.dangerBorder }]} accessibilityRole={'dialog' as never} accessibilityLabel="Clear all data" {...({ 'aria-modal': true } as object)}>
          <IconTile icon="trash" accent="red" size={44} />
          <Text style={s.dialogTitle} accessibilityRole="header">
            Clear all data?
          </Text>
          <Text style={s.dialogText}>This permanently deletes from {WEB ? 'this browser' : 'this device'}:</Text>
          <View style={s.dialogList}>
            <Text style={s.dialogText}>•  {itemCount === 1 ? '1 item you added' : `${itemCount} items you added`}</Text>
            {categoryCount > 0 && (
              <Text style={s.dialogText}>•  {categoryCount === 1 ? '1 category you added' : `${categoryCount} categories you added`}</Text>
            )}
            <Text style={s.dialogText}>•  Every setting on this page (back to the defaults)</Text>
            <Text style={s.dialogText}>•  The remembered last-used category</Text>
          </View>
          <Text style={s.dialogMuted}>Sample items are not stored, so they show again. This can't be undone; export your items first if you want a copy.</Text>
          {error && <Note tone="warn">Nothing could be deleted because this browser's storage refused the change. Try again.</Note>}
          <View style={s.dialogButtons}>
            <SmallButton label="Cancel" onPress={onCancel} disabled={busy} />
            <SmallButton label={busy ? 'Deleting…' : 'Delete everything'} icon="trash-outline" tone="danger" onPress={confirm} disabled={busy} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  banner: { borderRadius: 12, borderWidth: 1, borderColor: t.dangerBorder, backgroundColor: t.dangerBg, padding: 12, marginBottom: 16 },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    marginBottom: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.surfaceBorder,
    backgroundColor: t.surface,
  },
  profileTitle: { color: t.text, fontSize: 17, fontWeight: '700' },
  profileSub: { color: t.textMuted, fontSize: 13, marginTop: 2 },
  profileStat: { alignItems: 'flex-end' },
  profileCount: { color: t.text, fontSize: 20, fontWeight: '700' },
  profileCountLabel: { color: t.textMuted, fontSize: 12 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  status: { paddingHorizontal: 10, height: 26, borderRadius: 999, borderWidth: 1, borderColor: t.surfaceBorder, justifyContent: 'center' },
  statusText: { color: t.textMuted, fontSize: 12.5, fontWeight: '600' },
  about: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 16, gap: 8 },
  aboutText: { color: t.text, fontSize: 14.5, textAlign: 'center' },
  aboutVersion: { color: t.textMuted, fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
    gap: 10,
  },
  dialogTitle: { color: t.text, fontSize: 20, fontWeight: '700', marginTop: 4 },
  dialogText: { color: t.text, fontSize: 14.5, lineHeight: 20 },
  dialogList: { gap: 2 },
  dialogMuted: { color: t.textMuted, fontSize: 13, lineHeight: 18 },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
}));
