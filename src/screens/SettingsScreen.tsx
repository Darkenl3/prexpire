import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useTheme, accents, LIGHT, CARD_SHADOW_LIFTED } from '../theme';
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
import { Brandmark, GlassIconButton, NAV_HEIGHT, navOffset } from '../components/HomeComponents';
import { CategoryManager } from '../components/CategoryManager';
import { FadeIn, PressScale } from '../components/Press';
import { IconTile, Note, PickerRow, SettingRow, SettingsCard, SettingsSection, SmallButton, StatusBadge, Toggle } from '../components/SettingsRows';
import { useShopping } from '../shopping';
import { AlertSpacer } from '../components/ExpiryAlert';
import { notificationStatus, requestNotificationPermission, watchNotificationStatus, type NotificationStatus } from '../platform/notifications';
import { saveTextFile } from '../platform/saveFile';
import appConfig from '../../app.json';

const APP_VERSION: string = appConfig.expo.version;
const WEB = Platform.OS === 'web';

// The Settings tab, restructured after the reference: a grouped list of
// simple rows (icon tile + title + value + chevron) where every row opens its
// own destination - a detail page for browsing subjects, or an iOS-style
// picker sheet for choosing a value (warning period, date format, sorting…).
// The root list stays one glanceable screen.

type PageId =
  | 'profile'
  | 'privacy'
  | 'notifications'
  | 'categories'
  | 'appearance'
  | 'backup'
  | 'help'
  | 'terms';

const PAGE_TITLES: Record<PageId, string> = {
  profile: 'Profile',
  privacy: 'Privacy & Security',
  notifications: 'Notifications',
  categories: 'Categories',
  appearance: 'Appearance',
  backup: 'Backup & Sync',
  help: 'Help & Support',
  terms: 'Terms & Privacy',
};

type Props = { badge: number; onNavigate: (route: string) => void; initialPage?: 'categories' };

export function SettingsScreen({ onNavigate, initialPage }: Props) {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { settings, update, saveError, reset, motion, formatDate } = useSettings();
  const { saved, clearSaved } = useItems();
  const { all, clearAll: clearCategories } = useCategories();
  const { items: shoppingItems, clearAll: clearShopping } = useShopping();
  const [confirmClear, setConfirmClear] = useState(false);
  const [page, setPage] = useState<PageId | null>(initialPage ?? null);

  // Motion as a ref so animation timings never retrigger a running animation.
  const motionRef = useRef(motion);
  motionRef.current = motion;

  // Gentle one-time fade-in of the settings content.
  const appear = useRef(new Animated.Value(motion ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: motionRef.current ? 240 : 0, useNativeDriver: true }).start();
  }, [appear]);

  // The detail page slides in from the right edge with a soft fade, and the
  // root list drifts a little left for depth. Everything is transform/opacity
  // only, so the whole transition rides the native driver without ever
  // blocking touch: the animations describe the change, never gate it.
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (page) {
      slide.setValue(0);
      Animated.timing(slide, { toValue: 1, duration: motionRef.current ? 230 : 0, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [page, slide]);
  const closePage = useCallback(() => {
    Animated.timing(slide, { toValue: 0, duration: motionRef.current ? 210 : 0, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setPage(null));
  }, [slide]);
  const slideX = slide.interpolate({ inputRange: [0, 1], outputRange: [width, 0] });
  const pageFade = slide.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const rootShift = slide.interpolate({ inputRange: [0, 1], outputRange: [0, -28] });

  const open = (p: PageId) => setPage(p);

  const customCount = all.filter((cat) => cat.custom).length;
  const bottomPad = NAV_HEIGHT + navOffset(insets.bottom) + 24;
  const root = (
    <>
      {saveError && (
        <View style={s.banner} accessibilityRole="alert">
          <Note tone="warn">Your last change couldn't be saved in this browser's storage. It applies until you close the page.</Note>
        </View>
      )}

      <PressScale
        onPress={() => open('profile')}
        accessibilityRole="button"
        accessibilityLabel="Profile"
        style={s.profileCard}
        scaleTo={0.99}
      >
        <View style={s.avatar}>
          <Ionicons name="person" size={30} color={accents.mint} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.profileTitle}>Your preferences</Text>
          <Text style={s.profileSub} numberOfLines={1}>
            {WEB ? 'Saved in this browser' : 'Saved on this device'}. No account needed.
          </Text>
        </View>
        <View style={s.profileStat}>
          <Text style={s.profileCount}>{saved.length}</Text>
          <Text style={s.profileCountLabel}>{saved.length === 1 ? 'item added' : 'items added'}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.textMuted} style={{ marginLeft: 4, opacity: 0.75 }} />
      </PressScale>

      <SettingsSection title="Account">
        <SettingsCard>
          <SettingRow icon="person-outline" accent="mint" title="Profile" description="Your library and storage." onPress={() => open('profile')} />
          <SettingRow icon="shield-checkmark-outline" accent="blue" title="Privacy & Security" description="Camera access and stored data." onPress={() => open('privacy')} />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="App Preferences">
        <SettingsCard>
          <SettingRow icon="notifications-outline" accent="amber" title="Notifications" description="Expiry reminders and timing." onPress={() => open('notifications')} />
          <SettingRow icon="grid" accent="purple" title="Categories" description="Your folders and defaults." onPress={() => open('categories')} />
          <SettingRow icon="color-palette-outline" accent="pink" title="Appearance" description="Theme, density and motion." onPress={() => open('appearance')} />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Expiry & Lists">
        <SettingsCard>
          <PickerRow
            icon="hourglass-outline"
            accent="mint"
            title="Warning period"
            label="Warning period"
            description="How early items warn you."
            value={settings.warningDays}
            options={WARNING_DAYS.map((d) => ({ value: d, label: `${d} days` }))}
            onChange={(v) => update({ warningDays: v })}
          />
          <SettingRow
            icon="cart-outline"
            accent="mint"
            title="Automatic Shopping List"
            description="Add expiring products automatically."
            right={<Toggle label="Automatically add expiring products to the Shopping List" value={settings.autoShoppingList} onChange={(v) => update({ autoShoppingList: v })} />}
          />
          <PickerRow
            icon="calendar-outline"
            accent="teal"
            title="Date format"
            label="Date format"
            description={`Today shows as ${formatDate(isoToday(new Date()))}.`}
            value={settings.dateFormat}
            options={DATE_FORMATS.map((f) => ({ value: f, label: DATE_FORMAT_LABELS[f] }))}
            onChange={(v) => update({ dateFormat: v })}
          />
          <PickerRow
            icon="swap-vertical-outline"
            accent="blue"
            title="Default sorting"
            label="Default sorting"
            description="Order of the Items list."
            value={settings.sort}
            options={SORT_ORDERS.map((o) => ({ value: o, label: SORT_LABELS[o] }))}
            onChange={(v) => update({ sort: v })}
          />
          <SettingRow
            icon="eye-outline"
            accent="teal"
            title="Show expired items"
            description="Keep past-date items visible."
            right={<Toggle label="Show expired items" value={settings.showExpired} onChange={(v) => update({ showExpired: v })} />}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Data & Storage">
        <SettingsCard>
          <SettingRow
            icon="cloud-upload-outline"
            accent="mint"
            title="Backup & Sync"
            description="Nothing is uploaded or synced."
            right={<StatusBadge label="Off" />}
            onPress={() => open('backup')}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="About">
        <SettingsCard>
          <SettingRow icon="information-circle-outline" accent="blue" title="App version" value={APP_VERSION} />
          <SettingRow icon="help-circle-outline" accent="teal" title="Help & Support" onPress={() => open('help')} />
          <SettingRow icon="document-text-outline" accent="purple" title="Terms & Privacy" onPress={() => open('terms')} />
        </SettingsCard>
      </SettingsSection>

      <SettingsCard danger>
        <SettingRow
          icon="trash-outline"
          accent="red"
          title="Clear all data"
          titleColor={accents.red}
          description="Delete everything stored here."
          onPress={() => setConfirmClear(true)}
        />
      </SettingsCard>
    </>
  );

  return (
    <View style={[s.root, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <Animated.View style={{ flex: 1, opacity: appear, transform: [{ translateX: rootShift }] }}>
        <View style={[s.frame, s.rootFrame]}>
          <View style={s.header}>
            <GlassIconButton icon="chevron-back" iconSize={22} label="Go back" onPress={() => onNavigate('tab:home')} />
            <Text style={s.headerTitle} accessibilityRole="header">
              Settings
            </Text>
          </View>
        </View>
        <ScrollViewLike bottomPad={bottomPad}>
          <View style={[s.frame, s.rootFrame]}>{root}</View>
        </ScrollViewLike>
      </Animated.View>

      {page && (
        <Animated.View style={[s.overlay, { transform: [{ translateX: slideX }], opacity: pageFade }]}>
          <View style={[s.root, { paddingTop: insets.top }]}>
            <View style={[s.frame, s.rootFrame]}>
              <View style={s.header}>
                <GlassIconButton icon="chevron-back" iconSize={22} label="Go back" onPress={closePage} />
                <Text style={s.detailTitle} accessibilityRole="header">
                  {PAGE_TITLES[page]}
                </Text>
              </View>
            </View>
            <ScrollViewLike bottomPad={bottomPad}>
              <View style={[s.frame, s.rootFrame]}>{renderDetail(page, onNavigate)}</View>
            </ScrollViewLike>
          </View>
        </Animated.View>
      )}

      <ClearDataDialog
        visible={confirmClear}
        itemCount={saved.length}
        categoryCount={customCount}
        listCount={shoppingItems.length}
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          await clearSaved();
          await clearCategories();
          await clearShopping();
          await reset();
          setConfirmClear(false);
        }}
      />
    </View>
  );
}

// The scrolling body shared by the root list and every detail page. The
// reserved alert space sits at the very top, so an expiry alert pushes the
// page's content below it rather than covering it. Settings' own header is
// fixed (like the reference), so there is no scroll-driven chrome here at all.
function ScrollViewLike({ children, bottomPad }: { children: React.ReactNode; bottomPad: number }) {
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: bottomPad }}>
      <AlertSpacer />
      {children}
    </ScrollView>
  );
}

function renderDetail(page: PageId, onNavigate: (route: string) => void) {
  switch (page) {
    case 'profile':
      return <ProfileDetail />;
    case 'privacy':
      return <PrivacyDetail onNavigate={onNavigate} />;
    case 'notifications':
      return <NotificationsDetail />;
    case 'categories':
      return <CategoriesDetail onNavigate={onNavigate} />;
    case 'appearance':
      return <AppearanceDetail />;
    case 'backup':
      return <BackupDetail />;
    case 'help':
      return <HelpDetail />;
    case 'terms':
      return <TermsDetail />;
    default:
      return null;
  }
}

function ProfileDetail() {
  const s = useStyles();
  const { saved } = useItems();
  const { all } = useCategories();
  const { items: shopping } = useShopping();
  return (
    <>
      <View style={s.heroCard}>
        <View style={s.heroAvatar}>
          <Ionicons name="person" size={34} color={accents.mint} />
        </View>
        <Text style={s.heroTitle}>Your preferences</Text>
        <Text style={s.heroSub}>{WEB ? 'Saved in this browser' : 'Saved on this device'}. No account, no sign-in.</Text>
      </View>
      <SettingsSection title="Library">
        <SettingsCard>
          <SettingRow icon="cube-outline" accent="mint" title="Items added" value={`${saved.length}`} />
          <SettingRow icon="cart-outline" accent="mint" title="Shopping list entries" value={`${shopping.length}`} />
          <SettingRow icon="folder-open-outline" accent="blue" title="Your categories" value={`${all.length}`} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Storage">
        <SettingsCard>
          <SettingRow icon="server-outline" accent="teal" title="Where data lives" value={WEB ? 'This browser' : 'This device'} />
          <SettingRow icon="cloud-offline-outline" accent="amber" title="Synced" value="Never" />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

function PrivacyDetail({ onNavigate }: { onNavigate: (route: string) => void }) {
  return (
    <SettingsSection title="Privacy & Security">
      <SettingsCard>
        <SettingRow
          icon="camera-outline"
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
          icon="lock-closed-outline"
          accent="mint"
          title="Data storage"
          description={
            WEB
              ? "Items, categories and settings are stored only in this browser's local storage, on this device. Nothing is uploaded, synced or backed up, and clearing your browser data removes them."
              : 'Items, categories and settings are stored only on this device. Nothing is uploaded, synced or backed up.'
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}

function NotificationsDetail() {
  const { settings, update } = useSettings();
  return (
    <>
      <SettingsSection title="Reminders">
        <SettingsCard>
          <SettingRow
            icon="notifications-outline"
            accent="amber"
            title="Expiry reminders"
            description="Get notified before items expire."
            right={<Toggle label="Expiry reminders" value={settings.reminders} onChange={(v) => update({ reminders: v })} />}
          />
          <PickerRow
            icon="time-outline"
            accent="amber"
            title="Reminder timing"
            label="Reminder timing"
            description="When a reminder appears before the expiry date."
            value={settings.reminderLead}
            options={REMINDER_LEADS.map((l) => ({ value: l, label: reminderLeadLabel(l) }))}
            onChange={(v) => update({ reminderLead: v })}
          />
          <SettingRow
            icon="today-outline"
            accent="amber"
            title="Daily summary"
            description="See what's expiring soon."
            right={<Toggle label="Daily summary" value={settings.dailySummary} onChange={(v) => update({ dailySummary: v })} />}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Delivery">
        <SettingsCard>
          <BrowserNotificationsRow />
        </SettingsCard>
      </SettingsSection>
    </>
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
    granted: { text: 'This browser allows PREXPIRE to show notifications. Expiry alerts appear while the app is open; nothing is delivered in the background.', tone: 'ok' },
    denied: { text: "Notifications are blocked for this site. To allow them, change the site's notification setting in your browser, then come back. In-app expiry alerts still appear while the app is open.", tone: 'warn' },
    default: { text: 'Your browser will ask for permission when you select Allow. In-app expiry alerts appear while the app is open either way.', tone: 'muted' },
    unsupported: { text: WEB ? "This browser doesn't support web notifications. In-app expiry alerts still appear while the app is open." : 'System notifications are not set up in this version of the app. In-app expiry alerts appear while it is open.', tone: 'muted' },
    insecure: { text: 'Browsers only allow notifications on secure (https) pages. In-app expiry alerts still appear while the app is open.', tone: 'muted' },
  };

  const badgeTone = status === 'granted' ? 'green' : status === 'denied' ? 'amber' : 'muted';

  return (
    <SettingRow
      icon="globe-outline"
      accent="amber"
      title={WEB ? 'Browser notifications' : 'Notifications'}
      description={WEB ? 'Allow notifications from this browser.' : 'Allow notifications on this device.'}
      right={<StatusBadge key={status} label={label[status]} tone={badgeTone} check={status === 'granted'} />}
      below={
        <>
          <FadeIn key={status}>
            <Note tone={note[status].tone}>{note[status].text}</Note>
          </FadeIn>
          {status === 'default' && (
            <FadeIn>
              <View style={s.buttons}>
                <SmallButton label={asking ? 'Waiting for browser…' : 'Allow notifications'} icon="notifications-outline" tone="mint" disabled={asking} onPress={ask} />
              </View>
            </FadeIn>
          )}
        </>
      }
    />
  );
}

function CategoriesDetail({ onNavigate }: { onNavigate: (route: string) => void }) {
  const { settings, update } = useSettings();
  const { all } = useCategories();
  return (
    <>
      <SettingsSection title="Your categories">
        <SettingsCard>
          <SettingRow
            icon="folder-open-outline"
            accent="blue"
            title="Your categories"
            description="The built-ins you keep and the folders you add, all in one place."
            below={<CategoryManager />}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Defaults">
        <SettingsCard>
          <PickerRow<DefaultCategory>
            icon="pricetag-outline"
            accent="blue"
            title="Default category"
            label="Default category"
            description="Preselected when you add an item."
            value={settings.defaultCategory}
            onChange={(v) => update({ defaultCategory: v })}
            options={[{ value: 'last', label: 'Last used' }, ...all.map((cat) => ({ value: cat.id as DefaultCategory, label: cat.name }))]}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Browse">
        <SettingsCard>
          <SettingRow icon="grid" accent="purple" title="Browse categories" description="The lists for the categories you keep." onPress={() => onNavigate('tab:items')} />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

function AppearanceDetail() {
  const { settings, update, systemReduceMotion } = useSettings();
  return (
    <SettingsSection title="Appearance">
      <SettingsCard>
        <PickerRow
          icon="contrast-outline"
          accent="purple"
          title="Theme"
          label="Theme"
          description="Dark, light, or follow your device."
          value={settings.theme}
          options={THEME_MODES.map((m) => ({ value: m, label: THEME_LABELS[m] }))}
          onChange={(v) => update({ theme: v })}
          below={
            <FadeIn key={settings.theme}>
              <Note>
                {settings.theme === 'system'
                  ? 'System follows your device\u2019s appearance and switches live.'
                  : settings.theme === 'light'
                    ? 'A bright take on the same design.'
                    : 'The classic near-black look.'}
              </Note>
            </FadeIn>
          }
        />
        <SettingRow
          icon="reorder-four-outline"
          accent="blue"
          title="Compact layout"
          description="Shorter rows in item lists."
          right={<Toggle label="Compact layout" value={settings.compact} onChange={(v) => update({ compact: v })} />}
        />
        <SettingRow
          icon="sparkles-outline"
          accent="purple"
          title="Animations"
          description="Fades, press feedback and the scanner's sweep line."
          right={<Toggle label="Animations" value={settings.animations && !systemReduceMotion} disabled={systemReduceMotion} onChange={(v) => update({ animations: v })} />}
          below={systemReduceMotion ? <FadeIn><Note>Your device asks for reduced motion, so animations stay off.</Note></FadeIn> : undefined}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

function BackupDetail() {
  const { saved } = useItems();
  const { all } = useCategories();
  const s = useStyles();
  const [exportError, setExportError] = useState<string | null>(null);
  const exportAs = async (kind: 'json' | 'csv') => {
    setExportError(null);
    const now = new Date();
    try {
      if (kind === 'json') await saveTextFile(exportFileName('json', now), 'application/json', itemsToJson(saved, now, APP_VERSION));
      else {
        const names: Record<string, string> = {};
        for (const cat of all) names[cat.id] = cat.name;
        await saveTextFile(exportFileName('csv', now), 'text/csv', itemsToCsv(saved, names));
      }
    } catch {
      setExportError('The file could not be created. Your browser may be blocking downloads on this page.');
    }
  };
  return (
    <>
      <SettingsSection title="Backup & Sync">
        <SettingsCard>
          <SettingRow
            icon="cloud-offline-outline"
            accent="mint"
            title="Sync"
            description={WEB ? 'PREXPIRE has no cloud: items, categories and settings live only in this browser, on this device.' : 'PREXPIRE has no cloud: items, categories and settings live only on this device.'}
            right={<StatusBadge label="Off" />}
          />
          <SettingRow
            icon="download-outline"
            accent="teal"
            title="Export data"
            description={saved.length ? `Download your ${saved.length} added ${saved.length === 1 ? 'item' : 'items'}: name, category, expiry date, date precision, when added and source.` : 'Nothing to export yet. Items you add will be exported here (sample items are not included).'}
            below={
              <>
                <View style={s.buttons}>
                  <SmallButton label="JSON" icon="code-slash-outline" disabled={!saved.length} onPress={() => exportAs('json')} accessibilityLabel="Export items as JSON" />
                  <SmallButton label="CSV" icon="document-text-outline" disabled={!saved.length} onPress={() => exportAs('csv')} accessibilityLabel="Export items as CSV" />
                </View>
                {exportError && <Note tone="warn">{exportError}</Note>}
              </>
            }
          />
        </SettingsCard>
      </SettingsSection>
      <Note>To keep a copy, export before clearing your browser data or moving devices.</Note>
    </>
  );
}

function HelpDetail() {
  return (
    <SettingsSection title="How PREXPIRE works">
      <SettingsCard>
        <SettingRow
          icon="scan-outline"
          accent="teal"
          title="Scan a label"
          description="Open the scanner from the middle button in the bottom bar and point at a date. The frame is read on your device; nothing is ever uploaded."
        />
        <SettingRow
          icon="cube-outline"
          accent="mint"
          title="Track items"
          description="A scan becomes an item with its category, expiry date and a reminder. Home shows what needs attention first."
        />
        <SettingRow
          icon="folder-open-outline"
          accent="blue"
          title="Organise"
          description="Add your own category folders in Settings → Categories. Their tiles appear on Home, in lists and in the scanner."
        />
        <SettingRow
          icon="notifications-outline"
          accent="amber"
          title="Reminders"
          description="The Reminders tab lists what's due soon, and the bell shows how many items need attention."
        />
        <SettingRow
          icon="download-outline"
          accent="purple"
          title="Keep a copy"
          description="Export your items as JSON or CSV from Settings → Data & Storage."
        />
      </SettingsCard>
    </SettingsSection>
  );
}

function TermsDetail() {
  const s = useStyles();
  return (
    <>
      <SettingsSection title="Privacy">
        <SettingsCard>
          <SettingRow
            icon="lock-closed-outline"
            accent="mint"
            title="Your data"
            description={WEB ? 'Everything is stored only in this browser, on this device: no account, no cloud, no sync, no tracking.' : 'Everything is stored only on this device: no account, no cloud, no sync, no tracking.'}
          />
          <SettingRow icon="camera-outline" accent="teal" title="Camera" description="Frames are read locally to find expiry dates and are never uploaded or stored." />
          <SettingRow icon="share-social-outline" accent="purple" title="Exports" description="Files you export go wherever you choose; nothing is sent otherwise." />
        </SettingsCard>
      </SettingsSection>
      <View style={s.aboutFooter}>
        <Brandmark height={35} />
        <Text style={s.aboutTagline}>Keep track of what matters before it expires.</Text>
        <Text style={s.aboutVersion}>Version {APP_VERSION}</Text>
      </View>
    </>
  );
}

type DialogProps = { visible: boolean; itemCount: number; categoryCount: number; listCount: number; onCancel: () => void; onConfirm: () => Promise<void> };

function ClearDataDialog({ visible, itemCount, categoryCount, listCount, onCancel, onConfirm }: DialogProps) {
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
          <IconTile icon="trash-outline" accent="red" size={48} />
          <Text style={s.dialogTitle} accessibilityRole="header">
            Clear all data?
          </Text>
          <Text style={s.dialogText}>This permanently deletes from {WEB ? 'this browser' : 'this device'}:</Text>
          <View style={s.dialogList}>
            <Text style={s.dialogText}>•  {itemCount === 1 ? '1 item you added' : `${itemCount} items you added`}</Text>
            <Text style={s.dialogText}>•  {listCount === 1 ? '1 Shopping List entry' : `${listCount} Shopping List entries`}</Text>
            {categoryCount > 0 && (
              <Text style={s.dialogText}>•  {categoryCount === 1 ? '1 category you added' : `${categoryCount} categories you added`}</Text>
            )}
            <Text style={s.dialogText}>•  Every setting on this page (back to the defaults)</Text>
            <Text style={s.dialogText}>•  The remembered last-used category and expiration events</Text>
          </View>
          <Text style={s.dialogMuted}>This can't be undone; export your items first if you want a copy.</Text>
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
  root: { flex: 1, backgroundColor: t.bg },
  frame: { width: '100%', alignSelf: 'center' },
  // Settings reads best a touch narrower than the lists.
  rootFrame: { maxWidth: 640, paddingHorizontal: 16 },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 0 },
  headerTitle: { color: t.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.6 },
  detailTitle: { color: t.text, fontSize: 23, fontWeight: '700', letterSpacing: -0.4 },
  // The profile card floats a little higher than the section cards.
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    marginBottom: 26,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: t.surfaceBorder,
    backgroundColor: t.surface,
    ...(t === LIGHT ? CARD_SHADOW_LIFTED : null),
  },
  avatar: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: '#D9FBF0' },
  profileTitle: { color: t.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.2 },
  profileSub: { color: t.textMuted, fontSize: 13.5, marginTop: 2 },
  profileStat: { alignItems: 'flex-end' },
  profileCount: { color: t.text, fontSize: 20, fontWeight: '700' },
  profileCountLabel: { color: t.textMuted, fontSize: 12 },
  heroCard: { alignItems: 'center', paddingVertical: 26, paddingHorizontal: 16, marginBottom: 24, borderRadius: 20, borderWidth: 1, borderColor: t.surfaceBorder, backgroundColor: t.surface, ...(t === LIGHT ? CARD_SHADOW_LIFTED : null) },
  heroAvatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: '#D9FBF0', marginBottom: 12 },
  heroTitle: { color: t.text, fontSize: 21, fontWeight: '700', letterSpacing: -0.3 },
  heroSub: { color: t.textMuted, fontSize: 14, marginTop: 4, textAlign: 'center' },
  aboutFooter: { alignItems: 'center', paddingVertical: 26, paddingHorizontal: 16, gap: 8 },
  aboutTagline: { color: t.text, fontSize: 14.5, textAlign: 'center' },
  aboutVersion: { color: t.textMuted, fontSize: 13 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  banner: { borderRadius: 14, borderWidth: 1, borderColor: t.dangerBorder, backgroundColor: t.dangerBg, padding: 12, marginBottom: 16 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: t.bg, zIndex: 10, elevation: 6 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 10,
    ...(t === LIGHT ? CARD_SHADOW_LIFTED : null),
  },
  dialogTitle: { color: t.text, fontSize: 20, fontWeight: '700', marginTop: 4 },
  dialogText: { color: t.text, fontSize: 14.5, lineHeight: 20 },
  dialogList: { gap: 2 },
  dialogMuted: { color: t.textMuted, fontSize: 13, lineHeight: 18 },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
}));
