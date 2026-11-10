import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useTheme, accents, LIGHT, CARD_SHADOW_LIFTED, type Accent } from '../theme';
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
import { TAB_MS, TAB_SLIDE, tabEnterDirection } from '../components/TabTransition';
import { CategoryManager } from '../components/CategoryManager';
import { FadeIn, PressScale } from '../components/Press';
import { IconTile, Note, PickerRow, SettingRow, SettingsCard, SettingsSection, SmallButton, StatusBadge, Toggle } from '../components/SettingsRows';
import { SearchField } from '../components/SearchField';
import { useShopping } from '../shopping';
import { AlertSpacer } from '../components/ExpiryAlert';
import { nativeReminders, notificationStatus, openNotificationSettings, requestNotificationPermission, sendTestNotification, watchNotificationStatus, type NotificationStatus } from '../platform/notifications';
import { saveTextFile } from '../platform/saveFile';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BACKUP_PREFIX, backupFileName, buildBackup, parseBackup } from '../backup';
import { byCategory, byMonth, tally, usedInTime, withExpiredInList, type Tally } from '../stats';
import appConfig from '../../app.json';
import { useAuth } from '../auth';
import { ChangePasswordSheet, DeleteAccountSheet, SignInSheet } from '../components/SignInSheet';
import { useSync } from '../sync';
// The same text as prexpire.com/privacy and /terms (generated from one file
// in the landing repo, legal/legal.json), shown here as native pages so it
// reads offline and never sends the app out to a browser.
import legal from '../legal.json';
import { FREE_ITEM_LIMIT, nextReset, useMonthlyAdds, usePro } from '../pro';
import { FeedbackSheet } from '../components/FeedbackSheet';

export type LegalDoc = { title: string; updated: string; short: string[]; sections: { title: string; body: (string | { list: string[] })[] }[] };

// Inside the iPhone app: the installed app's own version and build, as the
// App Store shows it ("1.0.3 (114)"). In a browser: this web app's version.
const APP_VERSION: string =
  (typeof window !== 'undefined' && (window as { __prexpireAppVersion?: string }).__prexpireAppVersion) || appConfig.expo.version;
const WEB = Platform.OS === 'web';
type IconName = keyof typeof Ionicons.glyphMap;

// The Settings tab, restructured after the reference: a grouped list of
// simple rows (icon tile + title + value + chevron) where every row opens its
// own destination - a detail page for browsing subjects, or an iOS-style
// picker sheet for choosing a value (warning period, date format, sorting…).
// The root list stays one glanceable screen.

type PageId =
  | 'account'
  | 'profile'
  | 'privacy'
  | 'notifications'
  | 'categories'
  | 'appearance'
  | 'backup'
  | 'stats'
  | 'help'
  | 'terms'
  | 'privacyPolicy'
  | 'termsOfUse';

const PAGE_TITLES: Record<PageId, string> = {
  account: 'Account',
  profile: 'Profile',
  privacy: 'Privacy & Security',
  notifications: 'Notifications',
  categories: 'Categories',
  appearance: 'Appearance',
  backup: 'Backup & Restore',
  stats: 'Waste stats',
  help: 'Help & Support',
  terms: 'Terms & Privacy',
  privacyPolicy: 'Privacy Policy',
  termsOfUse: 'Terms of Use',
};

// 'signin' opens Settings with the sign-in sheet already up (from the
// get-started screen's "Have an account? Sign in").
type Props = { badge: number; onNavigate: (route: string) => void; initialPage?: 'categories' | 'signin' };

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
  const [page, setPage] = useState<PageId | null>(initialPage === 'categories' ? 'categories' : null);
  const { email } = useAuth();
  const [signInOpen, setSignInOpen] = useState(initialPage === 'signin');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // The settings search sheet, opened from the magnifier in the header.
  const [searchOpen, setSearchOpen] = useState(false);

  // Motion as a ref so animation timings never retrigger a running animation.
  const motionRef = useRef(motion);
  motionRef.current = motion;
  // The app's own Animations setting as a ref too. It deliberately does NOT
  // include the OS reduce-motion flag: this enter is Settings' core
  // navigation feedback — the tab-switch vocabulary (200 ms / 14 px) the
  // other screens use — and it follows the same ONE-gate rule as
  // TabTransition (see its header comment). The OS flag still gates the
  // larger within-Settings motions (the detail page's full-width slide).
  const animRef = useRef(settings.animations);
  animRef.current = settings.animations;

  // Gentle one-time fade-in of the settings content, joined with the shared
  // tab-switch slide (same 200 ms / 14 px vocabulary as every other screen —
  // resolved once at mount from which tab the user came; 0 = no slide).
  const appear = useRef(new Animated.Value(settings.animations ? 0 : 1)).current;
  const enterX = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const dir = tabEnterDirection('settings');
    // One gate for the whole enter: with the app's Animations setting on, the
    // fade and the small slide both play — whatever the OS says about
    // reduced motion (the same rule every other screen follows).
    if (dir !== 0 && animRef.current) enterX.setValue(dir * TAB_SLIDE);
    Animated.timing(enterX, { toValue: 0, duration: animRef.current ? TAB_MS : 0, useNativeDriver: true }).start();
    Animated.timing(appear, { toValue: 1, duration: animRef.current ? TAB_MS : 0, useNativeDriver: true }).start();
  }, [appear, enterX]);

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
          <Note tone="warn">Your last change couldn't be saved in this browser's storage. It applies until you close the page</Note>
        </View>
      )}

      {/* Account: signed out it invites a sign-in (optional, the app works
          without one); signed in it shows who, and opens the Account page. */}
      <PressScale
        onPress={() => (email ? open('account') : setSignInOpen(true))}
        accessibilityRole="button"
        accessibilityLabel={email ? `Account, signed in as ${email}` : 'Sign in to back up your items'}
        style={s.profileCard}
        scaleTo={0.99}
      >
        <View style={s.avatar}>
          {email ? (
            <Text style={s.avatarLetter}>{email[0].toUpperCase()}</Text>
          ) : (
            <Ionicons name="cloud-upload-outline" size={28} color={t.pills.green.text} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.profileTitle} numberOfLines={1}>{email ? email : 'Sign in'}</Text>
          <Text style={s.profileSub} numberOfLines={1}>
            {email ? 'Signed in' : 'Back up your items to an account'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.textMuted} style={{ marginLeft: 4, opacity: 0.75 }} />
      </PressScale>

      <ProRow />

      <SettingsSection title="General">
        <SettingsCard>
          <SettingRow icon="person-outline" accent="mint" title="Profile" description="Your library and storage" onPress={() => open('profile')} />
          <SettingRow icon="shield-checkmark-outline" accent="blue" title="Privacy & Security" description="Camera access and stored data" onPress={() => open('privacy')} />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="App Preferences">
        <SettingsCard>
          <SettingRow icon="notifications-outline" accent="amber" title="Notifications" description="Expiry reminders and timing" onPress={() => open('notifications')} />
          <SettingRow icon="grid" accent="purple" title="Categories" description="Your folders and defaults" onPress={() => open('categories')} />
          <SettingRow icon="color-palette-outline" accent="pink" title="Appearance" description="Theme, density and motion" onPress={() => open('appearance')} />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Expiry & Lists">
        <SettingsCard>
          <PickerRow
            icon="hourglass-outline"
            accent="mint"
            title="Warning period"
            label="Warning period"
            description="Days before expiry"
            value={settings.warningDays}
            options={WARNING_DAYS.map((d) => ({ value: d, label: `${d} days` }))}
            onChange={(v) => update({ warningDays: v })}
          />
          <SettingRow
            icon="cart-outline"
            accent="mint"
            title="Automatic Shopping List"
            description="Adds expiring products"
            right={<Toggle label="Automatically add expiring products to the Shopping List" value={settings.autoShoppingList} onChange={(v) => update({ autoShoppingList: v })} />}
          />
          <PickerRow
            icon="calendar-outline"
            accent="teal"
            title="Date format"
            label="Date format"
            description={formatDate(isoToday(new Date()))}
            value={settings.dateFormat}
            options={DATE_FORMATS.map((f) => ({ value: f, label: DATE_FORMAT_LABELS[f] }))}
            onChange={(v) => update({ dateFormat: v })}
          />
          <PickerRow
            icon="swap-vertical-outline"
            accent="blue"
            title="Sorting"
            label="Sorting"
            description="Order items"
            value={settings.sort}
            options={SORT_ORDERS.map((o) => ({ value: o, label: SORT_LABELS[o] }))}
            onChange={(v) => update({ sort: v })}
          />
          <SettingRow
            icon="eye-outline"
            accent="teal"
            title="Show expired items"
            description="Keep past-date items visible"
            right={<Toggle label="Show expired items" value={settings.showExpired} onChange={(v) => update({ showExpired: v })} />}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Insights">
        <SettingsCard>
          <SettingRow icon="leaf-outline" accent="mint" title="Waste stats" description="What you used in time and what expired" onPress={() => open('stats')} />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Data & Storage">
        <SettingsCard>
          <SettingRow
            icon="cloud-upload-outline"
            accent="mint"
            title="Backup & Restore"
            description="Save everything to a file, or restore one"
            onPress={() => open('backup')}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="About">
        <SettingsCard>
          <SettingRow icon="information-circle-outline" accent="blue" title="App version" value={APP_VERSION} />
          <SettingRow icon="help-circle-outline" accent="teal" title="Help & Support" onPress={() => open('help')} />
          <SettingRow icon="chatbubble-ellipses-outline" accent="mint" title="Send feedback" description="Report a bug, or share feedback or an idea" onPress={() => setFeedbackOpen(true)} />
          <SettingRow icon="document-text-outline" accent="purple" title="Terms & Privacy" onPress={() => open('terms')} />
        </SettingsCard>
      </SettingsSection>

      <SettingsCard danger>
        <SettingRow
          icon="trash-outline"
          accent="red"
          title="Clear all data"
          titleColor={accents.red}
          description="Delete everything stored here"
          onPress={() => setConfirmClear(true)}
        />
      </SettingsCard>
    </>
  );

  return (
    <View style={[s.root, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <Animated.View style={{ flex: 1, opacity: appear, transform: [{ translateX: rootShift }, { translateX: enterX }] }}>
        <View style={[s.frame, s.rootFrame]}>
          <View style={s.header}>
            {/* The compact 38pt glass back circle: the header's title row
                stays light, the button stops competing with it. */}
            <GlassIconButton icon="chevron-back" iconSize={20} size={38} label="Go back" onPress={() => onNavigate('tab:home')} />
            <Text style={s.headerTitle} accessibilityRole="header">
              Settings
            </Text>
            {/* The magnifier at the top right: opens the settings search sheet. */}
            <GlassIconButton icon="search" iconSize={19} size={38} label="Search settings" onPress={() => setSearchOpen(true)} />
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
                <GlassIconButton icon="chevron-back" iconSize={20} size={38} label="Go back" onPress={closePage} />
                <Text style={s.detailTitle} accessibilityRole="header">
                  {PAGE_TITLES[page]}
                </Text>
              </View>
            </View>
            <ScrollViewLike bottomPad={bottomPad}>
              <View style={[s.frame, s.rootFrame]}>{renderDetail(page, onNavigate, closePage, setPage)}</View>
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

      <SignInSheet visible={signInOpen} onClose={() => setSignInOpen(false)} />
      <FeedbackSheet visible={feedbackOpen} onClose={() => setFeedbackOpen(false)} appVersion={APP_VERSION} />

      <SettingsSearch
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenPage={(p) => {
          setSearchOpen(false);
          setPage(p);
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

// ---------------------------------------------------------------------------
// Settings search: the magnifier in the header opens this sheet. It indexes
// every setting the page can reach — the root rows and the detail pages' rows —
// by name and description, and a tap takes you where it lives.
// ---------------------------------------------------------------------------

type SearchEntry = {
  key: string;
  title: string;
  description?: string;
  icon: IconName;
  accent: Accent;
  // Where the setting lives: a detail page, or null for the root list itself.
  page: PageId | null;
};

function searchIndex(): SearchEntry[] {
  return [
    { key: 'profile', title: 'Profile', description: 'Your library and storage', icon: 'person-outline', accent: 'mint', page: 'profile' },
    { key: 'privacy', title: 'Privacy & Security', description: 'Camera access and stored data', icon: 'shield-checkmark-outline', accent: 'blue', page: 'privacy' },
    { key: 'notifications', title: 'Notifications', description: 'Expiry reminders and timing', icon: 'notifications-outline', accent: 'amber', page: 'notifications' },
    { key: 'expiry-reminders', title: 'Expiry reminders', description: 'Get notified before items expire', icon: 'notifications-outline', accent: 'amber', page: 'notifications' },
    { key: 'reminder-timing', title: 'Reminder timing', description: 'When a reminder appears before the expiry date', icon: 'time-outline', accent: 'amber', page: 'notifications' },
    { key: 'daily-summary', title: 'Daily summary', description: "See what's expiring soon", icon: 'today-outline', accent: 'amber', page: 'notifications' },
    { key: 'browser-notifications', title: WEB ? 'Browser notifications' : 'Notifications', description: WEB ? 'Allow notifications from this browser' : 'Allow notifications on this device', icon: 'globe-outline', accent: 'amber', page: 'notifications' },
    { key: 'categories', title: 'Categories', description: 'Your folders and defaults', icon: 'grid', accent: 'purple', page: 'categories' },
    { key: 'default-category', title: 'Default category', description: 'Preselected when you add an item', icon: 'pricetag-outline', accent: 'blue', page: 'categories' },
    { key: 'browse-categories', title: 'Browse categories', description: 'The lists for the categories you keep', icon: 'folder-open-outline', accent: 'purple', page: 'categories' },
    { key: 'appearance', title: 'Appearance', description: 'Theme, density and motion', icon: 'color-palette-outline', accent: 'pink', page: 'appearance' },
    { key: 'theme', title: 'Theme', description: 'Dark, light, or follow your device', icon: 'contrast-outline', accent: 'purple', page: 'appearance' },
    { key: 'compact', title: 'Compact layout', description: 'Shorter rows in item lists', icon: 'reorder-four-outline', accent: 'blue', page: 'appearance' },
    { key: 'animations', title: 'Animations', description: 'Fades, press feedback and the scanning line', icon: 'sparkles-outline', accent: 'purple', page: 'appearance' },
    { key: 'warning-period', title: 'Warning period', description: 'Days before expiry', icon: 'hourglass-outline', accent: 'mint', page: null },
    { key: 'auto-shopping', title: 'Automatic Shopping List', description: 'Adds expiring products', icon: 'cart-outline', accent: 'mint', page: null },
    { key: 'date-format', title: 'Date format', description: 'How dates are displayed', icon: 'calendar-outline', accent: 'teal', page: null },
    { key: 'sorting', title: 'Sorting', description: 'Order items', icon: 'swap-vertical-outline', accent: 'blue', page: null },
    { key: 'show-expired', title: 'Show expired items', description: 'Keep past-date items visible', icon: 'eye-outline', accent: 'teal', page: null },
    { key: 'backup', title: 'Backup & Restore', description: 'Save everything to a file, or restore one', icon: 'cloud-upload-outline', accent: 'mint', page: 'backup' },
    { key: 'stats', title: 'Waste stats', description: 'What you used in time and what expired', icon: 'leaf-outline', accent: 'mint', page: 'stats' },
    { key: 'export', title: 'Export data', description: 'Download your items as JSON or CSV', icon: 'download-outline', accent: 'teal', page: 'backup' },
    { key: 'help', title: 'Help & Support', description: 'How PREXPIRE works', icon: 'help-circle-outline', accent: 'teal', page: 'help' },
    { key: 'terms', title: 'Terms & Privacy', description: 'Your data, camera and exports', icon: 'document-text-outline', accent: 'purple', page: 'terms' },
    { key: 'clear-data', title: 'Clear all data', description: 'Delete everything stored here', icon: 'trash-outline', accent: 'red', page: null },
  ];
}

function SettingsSearch({ visible, onClose, onOpenPage }: { visible: boolean; onClose: () => void; onOpenPage: (page: PageId) => void }) {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);
  const entries = useMemo(searchIndex, []);
  const q = query.trim().toLowerCase();
  const results = q ? entries.filter((e) => `${e.title} ${e.description ?? ''}`.toLowerCase().includes(q)) : [];
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} {...({ 'aria-modal': true } as object)}>
      <View style={[s.searchRoot, { paddingTop: insets.top + 6, paddingLeft: insets.left, paddingRight: insets.right }]}>
        <View style={[s.frame, s.rootFrame, s.searchBody]}>
          <View style={s.header}>
            <GlassIconButton icon="chevron-back" iconSize={20} size={38} label="Close search" onPress={onClose} />
            <Text style={s.detailTitle} accessibilityRole="header">
              Search settings
            </Text>
          </View>
          <SearchField value={query} onChange={setQuery} placeholder="Search settings" accessibilityLabel="Search settings" />
          <ScrollView style={s.searchScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={s.searchContent}>
              {q === '' ? (
                <Text style={s.searchHint}>Type to find a setting by name or what it does</Text>
              ) : results.length === 0 ? (
                <Text style={s.searchHint}>No settings match “{query.trim()}”</Text>
              ) : (
                <View style={s.resultsCard}>
                  {results.map((e, i) => (
                    <Fragment key={e.key}>
                      {i > 0 && <View style={s.resultsDivider} />}
                      <PressScale
                        onPress={() => (e.page ? onOpenPage(e.page) : onClose())}
                        scaleTo={0.98}
                        pressedStyle={s.resultPressed}
                        accessibilityRole="button"
                        accessibilityLabel={e.title}
                        style={s.resultRow}
                      >
                        <IconTile icon={e.icon} accent={e.accent} size={36} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.resultTitle} numberOfLines={1}>
                            {e.title}
                          </Text>
                          {!!e.description && (
                            <Text style={s.resultDesc} numberOfLines={1}>
                              {e.description}
                            </Text>
                          )}
                        </View>
                        {e.page && (
                          <Text style={s.resultPage} numberOfLines={1}>
                            {PAGE_TITLES[e.page]}
                          </Text>
                        )}
                        <Ionicons name="chevron-forward" size={16} color={t.textMuted} />
                      </PressScale>
                    </Fragment>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function renderDetail(page: PageId, onNavigate: (route: string) => void, closePage: () => void, openPage: (p: PageId) => void) {
  switch (page) {
    case 'account':
      return <AccountDetail onSignedOut={closePage} />;
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
    case 'stats':
      return <StatsDetail />;
    case 'help':
      return <HelpDetail />;
    case 'terms':
      return <TermsDetail openPage={openPage} />;
    case 'privacyPolicy':
      return <LegalDetail doc={legal.privacy as LegalDoc} />;
    case 'termsOfUse':
      return <LegalDetail doc={legal.terms as LegalDoc} />;
    default:
      return null;
  }
}

// Prexpire Pro: the free plan's count, or Pro's status. Shown once the
// installed app can sell Pro.
function ProRow() {
  const { available, isPro, state, openPaywall } = usePro();
  const added = useMonthlyAdds();
  if (!available) return null;
  const description = isPro
    ? state?.lifetime
      ? 'Lifetime. Thank you for your support'
      : 'Active. No limits on items or categories'
    : `${Math.min(added, FREE_ITEM_LIMIT)} of ${FREE_ITEM_LIMIT} free items this month. Resets ${nextReset().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  return (
    <SettingsSection title="Plan">
      <SettingsCard>
        <SettingRow icon={isPro ? 'checkmark-circle' : 'sparkles-outline'} accent="mint" title="Prexpire Pro" description={description} onPress={() => openPaywall('settings')} />
      </SettingsCard>
    </SettingsSection>
  );
}

// Account: who is signed in, and signing out. Signing out keeps every item on
// this phone; it only disconnects the account.
function AccountDetail({ onSignedOut }: { onSignedOut: () => void }) {
  const s = useStyles();
  const t = useTheme();
  const { email, session } = useAuth();
  const { status, lastSyncAt, syncNow, signOutAndClear } = useSync();
  const { formatDate } = useSettings();
  const [busy, setBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [changePw, setChangePw] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const since = session?.user?.created_at ? new Date(session.user.created_at) : null;
  const synced = lastSyncAt ? new Date(lastSyncAt) : null;
  const ago = synced
    ? Date.now() - synced.getTime() < 60000
      ? 'Just now'
      : synced.toDateString() === new Date().toDateString()
        ? synced.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        : formatDate(synced.toISOString().slice(0, 10))
    : 'Not yet';
  const backupValue = status === 'syncing' ? 'Backing up…' : status === 'offline' ? 'Offline' : status === 'error' ? "Didn't finish" : ago;
  return (
    <>
      <View style={s.heroCard}>
        <View style={s.heroAvatar}>
          <Text style={s.avatarLetter}>{(email ?? '?')[0].toUpperCase()}</Text>
        </View>
        <Text style={s.heroTitle} numberOfLines={1}>{email ?? 'Signed out'}</Text>
        <Text style={s.heroSub}>{since ? `Account since ${since.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}` : 'Signed in'}</Text>
      </View>
      <SettingsSection title="Backup and sync">
        <SettingsCard>
          <SettingRow icon={status === 'offline' ? 'cloud-offline-outline' : 'cloud-done-outline'} accent="mint" title="Last backed up" value={backupValue} />
          <SettingRow icon="refresh-outline" accent="teal" title="Back up now" description="Also brings in changes from your other phones" onPress={() => syncNow()} />
        </SettingsCard>
        {status === 'offline' || status === 'error' ? (
          <Note>
            {status === 'offline'
              ? "You're offline. Your items are safe on this phone, and they'll back up when you're connected."
              : "The last backup didn't finish. It tries again on its own; you can also tap Back up now."}
          </Note>
        ) : null}
      </SettingsSection>
      <SettingsSection title="Session">
        <SettingsCard>
          <SettingRow icon="key-outline" accent="blue" title="Change password" description="Choose a new password for this account" onPress={() => setChangePw(true)} />
          <SettingRow
            icon="log-out-outline"
            accent="amber"
            title={busy ? 'Signing out…' : 'Sign out'}
            description="Removes your items from this phone. They stay in your account"
            onPress={async () => {
              if (busy) return;
              setBusy(true);
              setSignOutError(null);
              const problem = await signOutAndClear();
              setBusy(false);
              if (problem) return setSignOutError(problem);
              onSignedOut();
            }}
          />
        </SettingsCard>
        {signOutError ? <Note tone="warn">{signOutError}</Note> : null}
      </SettingsSection>
      <SettingsSection title="Delete account">
        <SettingsCard>
          <SettingRow icon="trash-outline" accent="red" title="Delete account" titleColor={t.red} description="Deleted for good after 30 days" onPress={() => setDeleting(true)} />
        </SettingsCard>
      </SettingsSection>
      <ChangePasswordSheet visible={changePw} onClose={() => setChangePw(false)} />
      <DeleteAccountSheet visible={deleting} onClose={() => setDeleting(false)} onDeleted={onSignedOut} />
    </>
  );
}

function ProfileDetail() {
  const t = useTheme();
  const s = useStyles();
  const { saved } = useItems();
  const { all } = useCategories();
  const { items: shopping } = useShopping();
  return (
    <>
      <View style={s.heroCard}>
        <View style={s.heroAvatar}>
          <Ionicons name="person" size={34} color={t.pills.green.text} />
        </View>
        <Text style={s.heroTitle}>Preferences</Text>
        <Text style={s.heroSub}>{WEB ? 'Saved in this browser' : 'Saved on this device'}</Text>
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
              ? "The scanner asks your browser for the camera when you open it. Frames are read in the browser and never uploaded. To change access, use your browser's site settings"
              : 'The scanner asks for the camera when you open it. Frames are read on the device and never uploaded. To change access, use the Settings app'
          }
          below={<SmallButton label="Open scanner" icon="scan-outline" onPress={() => onNavigate('scan')} />}
        />
        <SettingRow
          icon="lock-closed-outline"
          accent="mint"
          title="Data storage"
          description={
            WEB
              ? "Items, categories and settings are stored only in this browser's local storage, on this device. Nothing is uploaded, synced or backed up, and clearing your browser data removes them"
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
            description="Get notified before items expire"
            right={<Toggle label="Expiry reminders" value={settings.reminders} onChange={(v) => update({ reminders: v })} />}
          />
          <PickerRow
            icon="time-outline"
            accent="amber"
            title="Reminder timing"
            label="Reminder timing"
            description="When a reminder appears before the expiry date"
            value={settings.reminderLead}
            options={REMINDER_LEADS.map((l) => ({ value: l, label: reminderLeadLabel(l) }))}
            onChange={(v) => update({ reminderLead: v })}
          />
          <SettingRow
            icon="today-outline"
            accent="amber"
            title="Daily summary"
            description="See what's expiring soon"
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
  const [testing, setTesting] = useState(false);
  const [testSent, setTestSent] = useState(false);
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
    granted: { text: 'This browser allows PREXPIRE to show notifications. Expiry alerts appear while the app is open; nothing is delivered in the background', tone: 'ok' },
    denied: { text: "Notifications are blocked for this site. To allow them, change the site's notification setting in your browser, then come back. In-app expiry alerts still appear while the app is open", tone: 'warn' },
    default: { text: 'Your browser will ask for permission when you select Allow. In-app expiry alerts appear while the app is open either way', tone: 'muted' },
    unsupported: { text: WEB ? "This browser doesn't support web notifications. In-app expiry alerts still appear while the app is open" : 'System notifications are not set up in this version of the app. In-app expiry alerts appear while it is open', tone: 'muted' },
    insecure: { text: 'Browsers only allow notifications on secure (https) pages. In-app expiry alerts still appear while the app is open', tone: 'muted' },
  };

  const badgeTone = status === 'granted' ? 'green' : status === 'denied' ? 'amber' : 'muted';

  // Inside the iPhone app: real reminders, delivered even when it's closed.
  if (nativeReminders()) {
    const appNote: Record<NotificationStatus, { text: string; tone: 'ok' | 'warn' | 'muted' }> = {
      granted: { text: 'Reminders are set automatically from your items and arrive even when Prexpire is closed', tone: 'ok' },
      denied: { text: 'Notifications are off for Prexpire. Turn them on in iPhone Settings, then come back', tone: 'warn' },
      default: { text: 'Allow notifications to get reminded before your items expire, even when Prexpire is closed', tone: 'muted' },
      unsupported: { text: '', tone: 'muted' },
      insecure: { text: '', tone: 'muted' },
    };
    const test = async () => {
      setTesting(true);
      setTestSent(false);
      const s = await sendTestNotification();
      setStatus(s);
      setTesting(false);
      setTestSent(s === 'granted');
    };
    return (
      <SettingRow
        icon="notifications-outline"
        accent="amber"
        title="Notifications"
        description="Expiry reminders on this iPhone"
        right={<StatusBadge key={status} label={label[status]} tone={badgeTone} check={status === 'granted'} />}
        below={
          <>
            <FadeIn key={status}>
              <Note tone={appNote[status].tone}>{testSent ? 'Test sent. It arrives in a few seconds, even if you close the app now' : appNote[status].text}</Note>
            </FadeIn>
            <View style={s.buttons}>
              {status === 'default' && <SmallButton label={asking ? 'Waiting…' : 'Allow notifications'} icon="notifications-outline" tone="mint" disabled={asking} onPress={ask} />}
              {status === 'denied' && <SmallButton label="Open iPhone Settings" icon="settings-outline" tone="mint" onPress={openNotificationSettings} />}
              {status !== 'denied' && <SmallButton label={testing ? 'Sending…' : 'Send a test notification'} icon="paper-plane-outline" disabled={testing} onPress={test} />}
            </View>
          </>
        }
      />
    );
  }

  return (
    <SettingRow
      icon="globe-outline"
      accent="amber"
      title={WEB ? 'Browser notifications' : 'Notifications'}
      description={WEB ? 'Allow notifications from this browser' : 'Allow notifications on this device'}
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
            description="The built-ins you keep and the folders you add, all in one place"
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
            description="Preselected when you add an item"
            value={settings.defaultCategory}
            onChange={(v) => update({ defaultCategory: v })}
            options={[{ value: 'last', label: 'Last used' }, ...all.map((cat) => ({ value: cat.id as DefaultCategory, label: cat.name }))]}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Browse">
        <SettingsCard>
          <SettingRow icon="grid" accent="purple" title="Browse categories" description="The lists for the categories you keep" onPress={() => onNavigate('tab:items')} />
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
          description="Dark, light, or follow your device"
          value={settings.theme}
          options={THEME_MODES.map((m) => ({ value: m, label: THEME_LABELS[m] }))}
          onChange={(v) => update({ theme: v })}
          below={
            <FadeIn key={settings.theme}>
              <Note>
                {settings.theme === 'system'
                  ? 'System follows your device\u2019s appearance and switches live'
                  : settings.theme === 'light'
                    ? 'A bright take on the same design'
                    : 'The classic near-black look'}
              </Note>
            </FadeIn>
          }
        />
        <SettingRow
          icon="reorder-four-outline"
          accent="blue"
          title="Compact layout"
          description="Shorter rows in item lists"
          right={<Toggle label="Compact layout" value={settings.compact} onChange={(v) => update({ compact: v })} />}
        />
        <SettingRow
          icon="sparkles-outline"
          accent="purple"
          title="Animations"
          description="Fades and press feedback"
          right={<Toggle label="Animations" value={settings.animations && !systemReduceMotion} disabled={systemReduceMotion} onChange={(v) => update({ animations: v })} />}
          below={systemReduceMotion ? <FadeIn><Note>Your device asks for reduced motion, so animations stay off</Note></FadeIn> : undefined}
        />
        <SettingRow
          icon="scan-outline"
          accent="mint"
          title="Scanning Line Animation"
          description="Show or hide the moving scanning line during product scanning"
          right={<Toggle label="Scanning Line Animation" value={settings.scanLineAnimation} onChange={(v) => update({ scanLineAnimation: v })} />}
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
  // The full backup: every key Prexpire stores, in one file.
  const [backupNote, setBackupNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [pending, setPending] = useState<{ data: Record<string, string>; items: number; createdAt: string | null } | null>(null);
  const saveBackup = async () => {
    setBackupNote(null);
    try {
      const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(BACKUP_PREFIX));
      const entries = await AsyncStorage.multiGet(keys);
      const now = new Date();
      await saveTextFile(backupFileName(now), 'application/json', buildBackup(entries, APP_VERSION, now));
      setBackupNote({ tone: 'ok', text: 'Backup file created. Keep it somewhere safe, such as iCloud Drive or Files.' });
    } catch {
      setBackupNote({ tone: 'warn', text: "The backup file couldn't be created here." });
    }
  };
  const pickBackup = () => {
    setBackupNote(null);
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const parsed = parseBackup(await file.text());
      if (!parsed.ok) setBackupNote({ tone: 'warn', text: parsed.reason });
      else setPending({ data: parsed.data, items: parsed.items, createdAt: parsed.createdAt });
    };
    input.click();
  };
  const restore = async () => {
    if (!pending) return;
    try {
      // Everything stored now is replaced by the backup, then the app starts
      // over from it.
      const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(BACKUP_PREFIX) && !(k in pending.data));
      if (keys.length) await AsyncStorage.multiRemove(keys);
      await AsyncStorage.multiSet(Object.entries(pending.data));
      if (typeof window !== 'undefined') window.location.reload();
    } catch {
      setPending(null);
      setBackupNote({ tone: 'warn', text: "The backup couldn't be restored. Nothing was changed." });
    }
  };
  return (
    <>
      <SettingsSection title="Backup">
        <SettingsCard>
          <SettingRow
            icon="archive-outline"
            accent="mint"
            title="Save a backup"
            description="Items, categories, settings, Shopping List and stats, in one file"
            below={
              <View style={s.buttons}>
                <SmallButton label="Save backup" icon="download-outline" tone="mint" onPress={() => void saveBackup()} />
              </View>
            }
          />
          <SettingRow
            icon="refresh-circle-outline"
            accent="blue"
            title="Restore a backup"
            description="Replaces everything here with the backup's contents"
            below={
              <>
                {pending ? (
                  <>
                    <Note tone="warn">
                      {`Restore ${pending.items} ${pending.items === 1 ? 'item' : 'items'}${pending.createdAt ? ` saved ${new Date(pending.createdAt).toLocaleDateString()}` : ''}? What is here now will be replaced.`}
                    </Note>
                    <View style={s.buttons}>
                      <SmallButton label="Cancel" onPress={() => setPending(null)} />
                      <SmallButton label="Restore" icon="refresh-outline" tone="mint" onPress={() => void restore()} />
                    </View>
                  </>
                ) : (
                  <View style={s.buttons}>
                    <SmallButton label="Choose file" icon="folder-open-outline" onPress={pickBackup} />
                  </View>
                )}
                {backupNote && <Note tone={backupNote.tone === 'warn' ? 'warn' : undefined}>{backupNote.text}</Note>}
              </>
            }
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Sync">
        <SettingsCard>
          <SettingRow
            icon="cloud-offline-outline"
            accent="mint"
            title="Sync"
            description={WEB ? 'PREXPIRE has no cloud: items, categories and settings live only in this browser, on this device' : 'PREXPIRE has no cloud: items, categories and settings live only on this device'}
            right={<StatusBadge label="Off" />}
          />
          <SettingRow
            icon="download-outline"
            accent="teal"
            title="Export data"
            description={saved.length ? `Download your ${saved.length} added ${saved.length === 1 ? 'item' : 'items'}: name, category, expiry date, date precision, when added and source` : 'Nothing to export yet. Items you add will be exported here (sample items are not included)'}
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
      <Note>To keep a copy, export before clearing your browser data or moving devices</Note>
    </>
  );
}

// Waste stats: the history of items that left the list (Mark as consumed
// counts as used; removing an item after its date counts as expired) plus the
// items that have expired but are still in the list.
function StatsDetail() {
  const c = useTheme();
  const s = useStyles();
  const { history, saved } = useItems();
  const { nameOf } = useCategories();
  const { warning } = useSettings();
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const entries = withExpiredInList(history, saved, todayIso);
  const thisMonth = byMonth(entries, now, 1)[0].tally;
  const total = tally(entries);
  const months = byMonth(entries, now, 6);
  const peak = Math.max(1, ...months.map((m) => m.tally.used + m.tally.expired));
  const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const soon = saved.filter((i) => {
    const d = Math.round((new Date(i.expiresOn).getTime() - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    return d >= 0 && d <= warning(i.category);
  }).length;
  const pct = (t: Tally) => {
    const p = usedInTime(t);
    return p === null ? '–' : `${Math.round(p * 100)}%`;
  };
  const stat = (label: string, value: string, color: string) => (
    <View style={s.statBox}>
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
  return (
    <>
      <SettingsSection title="This month">
        <View style={s.statGrid}>
          {stat('Used in time', pct(thisMonth), c.green)}
          {stat('Used', String(thisMonth.used), c.text)}
          {stat('Expired', String(thisMonth.expired), c.red)}
        </View>
      </SettingsSection>
      <SettingsSection title="Last 6 months">
        <SettingsCard>
          <View style={s.chart} accessibilityLabel="Used and expired items per month">
            {months.map((m) => {
              const used = (m.tally.used / peak) * 100;
              const expired = (m.tally.expired / peak) * 100;
              return (
                <View key={m.key} style={s.chartCol}>
                  <View style={s.chartBarArea}>
                    <View style={[s.chartBar, { height: `${expired}%`, backgroundColor: c.red, borderTopLeftRadius: 6, borderTopRightRadius: 6 }]} />
                    <View style={[s.chartBar, { height: `${used}%`, backgroundColor: c.green, ...(expired ? null : { borderTopLeftRadius: 6, borderTopRightRadius: 6 }) }]} />
                  </View>
                  <Text style={s.chartLabel}>{MONTH[m.month]}</Text>
                </View>
              );
            })}
          </View>
          <View style={s.legend}>
            <View style={[s.legendDot, { backgroundColor: c.green }]} />
            <Text style={s.statLabel}>Used</Text>
            <View style={[s.legendDot, { backgroundColor: c.red, marginLeft: 12 }]} />
            <Text style={s.statLabel}>Expired</Text>
          </View>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="All time">
        <SettingsCard>
          <SettingRow icon="checkmark-done" accent="mint" title="Used in time" value={pct(total)} />
          <SettingRow icon="restaurant-outline" accent="teal" title="Items used" value={String(total.used)} />
          <SettingRow icon="trash-outline" accent="red" title="Expired before use" value={String(total.expired)} />
          <SettingRow icon="time-outline" accent="amber" title="Expiring soon now" value={String(soon)} />
        </SettingsCard>
      </SettingsSection>
      {entries.length > 0 && (
        <SettingsSection title="By category">
          <SettingsCard>
            {byCategory(entries).map((row) => (
              <SettingRow
                key={row.category}
                icon="folder-open-outline"
                accent="blue"
                title={nameOf(row.category)}
                description={`${row.tally.used} used · ${row.tally.expired} expired`}
                value={pct(row.tally)}
              />
            ))}
          </SettingsCard>
        </SettingsSection>
      )}
      <Note>
        {entries.length
          ? 'Use "Mark as consumed" when you finish something: it counts as used. Anything past its date counts as expired, whether it\'s still in your list or removed.'
          : 'Nothing yet. Use "Mark as consumed" in an item\'s menu when you finish it; anything past its date counts as expired.'}
      </Note>
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
          description="Open the scanner from the middle button in the bottom bar and point at a date. The frame is read on your device; nothing is ever uploaded"
        />
        <SettingRow
          icon="cube-outline"
          accent="mint"
          title="Track items"
          description="A scan becomes an item with its category, expiry date and a reminder. Home shows what needs attention first"
        />
        <SettingRow
          icon="folder-open-outline"
          accent="blue"
          title="Organise"
          description="Add your own category folders in Settings → Categories. Their tiles appear on Home, in lists and in the scanner"
        />
        <SettingRow
          icon="notifications-outline"
          accent="amber"
          title="Reminders"
          description="The Reminders tab lists what's due soon, and the bell shows how many items need attention"
        />
        <SettingRow
          icon="download-outline"
          accent="purple"
          title="Keep a copy"
          description="Export your items as JSON or CSV from Settings → Data & Storage"
        />
      </SettingsCard>
    </SettingsSection>
  );
}

function TermsDetail({ openPage }: { openPage: (p: PageId) => void }) {
  const s = useStyles();
  return (
    <>
      <SettingsSection title="Documents">
        <SettingsCard>
          <SettingRow icon="shield-checkmark-outline" accent="mint" title="Privacy Policy" description={`Last updated ${legal.privacy.updated}`} onPress={() => openPage('privacyPolicy')} />
          <SettingRow icon="document-text-outline" accent="blue" title="Terms of Use" description={`Last updated ${legal.terms.updated}`} onPress={() => openPage('termsOfUse')} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="In short">
        <SettingsCard>
          <SettingRow
            icon="phone-portrait-outline"
            accent="teal"
            title="Your data"
            description="Stored on this phone. With an optional account, a copy is backed up so it's the same on your other phones"
          />
          <SettingRow icon="camera-outline" accent="teal" title="Camera" description="Labels are read on the phone; images are never uploaded or kept" />
          <SettingRow icon="barcode-outline" accent="purple" title="Barcodes" description="Only the barcode number is sent to product databases, to find the name" />
          <SettingRow icon="eye-off-outline" accent="purple" title="No ads, no tracking" description={`Questions: ${legal.contact}`} />
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

// A legal document as a native page: the short version first (on the
// forest plate, like the website), then the numbered sections.
export function LegalDetail({ doc }: { doc: LegalDoc }) {
  const t = useTheme();
  const s = useStyles();
  return (
    <>
      <Text style={s.legalUpdated}>Last updated {doc.updated}</Text>
      <View style={s.legalShort}>
        <Text style={s.legalShortTitle}>The short version</Text>
        {doc.short.map((line) => (
          <View key={line} style={s.legalShortRow}>
            <Ionicons name="checkmark-circle" size={18} color="#A6DF6B" style={{ marginTop: 2 }} />
            <Text style={s.legalShortText}>{line}</Text>
          </View>
        ))}
      </View>
      {doc.sections.map((section, i) => (
        <View key={section.title} style={s.legalSection}>
          <Text style={s.legalHeading} accessibilityRole="header">
            <Text style={{ color: t.green }}>{i + 1}  </Text>
            {section.title}
          </Text>
          {section.body.map((part, j) =>
            typeof part === 'string' ? (
              <Text key={j} style={s.legalText}>{part}</Text>
            ) : (
              <View key={j} style={{ gap: 6, marginBottom: 10 }}>
                {part.list.map((li) => (
                  <View key={li} style={s.legalBullet}>
                    <View style={[s.legalDot, { backgroundColor: t.green }]} />
                    <Text style={[s.legalText, { flex: 1, marginBottom: 0 }]}>{li}</Text>
                  </View>
                ))}
              </View>
            ),
          )}
        </View>
      ))}
      <Text style={s.legalFoot}>Also at prexpire.com/{doc === legal.privacy ? 'privacy' : 'terms'}</Text>
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
          <Text style={s.dialogMuted}>This can't be undone; export your items first if you want a copy</Text>
          {error && <Note tone="warn">Nothing could be deleted because this browser's storage refused the change. Try again</Note>}
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
  headerTitle: { flex: 1, color: t.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.6 },
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
  avatar: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: t.pills.green.bg },
  profileTitle: { color: t.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.2 },
  profileSub: { color: t.textSub, fontSize: 13.5, marginTop: 2 },
  avatarLetter: { color: t.pills.green.text, fontSize: 24, fontWeight: '800' },
  heroCard: { alignItems: 'center', paddingVertical: 26, paddingHorizontal: 16, marginBottom: 24, borderRadius: 20, borderWidth: 1, borderColor: t.surfaceBorder, backgroundColor: t.surface, ...(t === LIGHT ? CARD_SHADOW_LIFTED : null) },
  heroAvatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: t.pills.green.bg, marginBottom: 12 },
  heroTitle: { color: t.text, fontSize: 21, fontWeight: '700', letterSpacing: -0.3 },
  heroSub: { color: t.textSub, fontSize: 14, marginTop: 4, textAlign: 'center' },
  aboutFooter: { alignItems: 'center', paddingVertical: 26, paddingHorizontal: 16, gap: 8 },
  legalUpdated: { color: t.textSub, fontSize: 13.5, marginBottom: 12, marginLeft: 4 },
  legalShort: { backgroundColor: '#0F3A2A', borderRadius: 20, padding: 18, gap: 10, marginBottom: 22 },
  legalShortTitle: { color: '#EDF3EE', fontSize: 17, fontWeight: '800', marginBottom: 2 },
  legalShortRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  legalShortText: { flex: 1, color: '#EDF3EE', fontSize: 15, lineHeight: 21 },
  legalSection: { marginBottom: 18, paddingHorizontal: 4 },
  legalHeading: { color: t.text, fontSize: 17.5, fontWeight: '800', letterSpacing: -0.2, marginBottom: 8 },
  legalText: { color: t.text, fontSize: 15.5, lineHeight: 23, marginBottom: 10, opacity: 0.92 },
  legalBullet: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  legalDot: { width: 6, height: 6, borderRadius: 3, marginTop: 9 },
  legalFoot: { color: t.textSub, fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 8 },
  aboutTagline: { color: t.text, fontSize: 14.5, textAlign: 'center' },
  aboutVersion: { color: t.textMuted, fontSize: 13 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // Waste stats.
  statGrid: { flexDirection: 'row', gap: 10 },
  statBox: { flex: 1, borderRadius: 16, borderWidth: 1, borderColor: t.surfaceBorder, backgroundColor: t.surface, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { color: t.textMuted, fontSize: 12.5, fontWeight: '600' },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, height: 150, paddingHorizontal: 14, paddingTop: 14 },
  chartCol: { flex: 1, alignItems: 'center', gap: 6, height: '100%' },
  chartBarArea: { flex: 1, width: '70%', justifyContent: 'flex-end' },
  chartBar: { width: '100%' },
  chartLabel: { color: t.textMuted, fontSize: 11.5, fontWeight: '600' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 14 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  banner: { borderRadius: 16, borderWidth: 1, borderColor: t.dangerBorder, backgroundColor: t.dangerBg, padding: 12, marginBottom: 16 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: t.bg, zIndex: 10, elevation: 6 },
  backdrop: { flex: 1, backgroundColor: 'rgba(3,7,9,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
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
  // The settings search sheet: the page's own frame and header language, with
  // results as one grouped card of compact rows.
  searchRoot: { flex: 1, backgroundColor: t.bg },
  searchBody: { flex: 1 },
  searchScroll: { flex: 1 },
  searchContent: { paddingTop: 14, paddingBottom: 40 },
  searchHint: { color: t.textSub, fontSize: 14, paddingVertical: 10 },
  resultsCard: { borderRadius: 16, borderWidth: 1, borderColor: t.surfaceBorder, backgroundColor: t.surface, overflow: 'hidden' },
  resultsDivider: { height: StyleSheet.hairlineWidth, backgroundColor: t.separator, marginLeft: 50 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  resultTitle: { color: t.text, fontSize: 15, fontWeight: '600' },
  resultDesc: { color: t.textSub, fontSize: 12.5, marginTop: 1.5 },
  resultPage: { color: t.textMuted, fontSize: 12, maxWidth: 110 },
  resultPressed: { backgroundColor: t === LIGHT ? 'rgba(102,135,125,0.10)' : 'rgba(255,255,255,0.05)' },
}));
