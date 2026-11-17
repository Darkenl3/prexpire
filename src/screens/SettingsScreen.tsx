import { useDensity } from '../density';
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
  reminderHourLabel,
  REMINDER_HOURS,
  SORT_LABELS,
  SORT_ORDERS,
  THEME_LABELS,
  PAD_LAYOUTS,
  PAD_LAYOUT_LABELS,
  THEME_MODES,
  WARNING_DAYS,
  type DefaultCategory,
} from '../preferences';
import { isoToday } from '../scanner/dateParser';
import { Brandmark, GlassIconButton, NAV_HEIGHT, navOffset } from '../components/HomeComponents';
import { TAB_MS, TAB_SLIDE, tabEnterDirection } from '../components/TabTransition';
import { CategoryManager } from '../components/CategoryManager';
import { FadeIn, PressScale } from '../components/Press';
import { IconTile, Note, PlanUsageRow, PickerRow, SettingRow, SettingsCard, SettingsSection, SmallButton, StatusBadge, Toggle } from '../components/SettingsRows';
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
import { TwoColumns, TwoUpList } from '../components/TwoUp';
import { SupportPage } from '../components/SupportPage';
import { openStore, useStoreUpdate } from '../appStore';

import { LANGUAGES, applyLanguage, availableLanguages, phoneLanguage, tr, type LanguageChoice, dirIcon, dateLocale } from '../i18n';
export type LegalDoc = { title: string; updated: string; short: string[]; sections: { title: string; body: (string | { list: string[] })[] }[] };

// Inside the iPhone app: the installed app's own version and build
// ("1.0.3 (114)"), sent with feedback and backups so a report pins the exact
// build. People see just the version (APP_VERSION_SHOWN, "1.0.3"). In a
// browser: this web app's version.
const APP_VERSION: string =
  (typeof window !== 'undefined' && (window as { __prexpireAppVersion?: string }).__prexpireAppVersion) || appConfig.expo.version;
const APP_VERSION_SHOWN = APP_VERSION.split(' ')[0];
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
  account: tr("Account"),
  profile: tr("Profile"),
  privacy: tr("Privacy & Security"),
  notifications: tr("Notifications"),
  categories: tr("Categories"),
  appearance: tr("Appearance"),
  backup: tr("Backup & Restore"),
  stats: tr("Waste stats"),
  help: tr("Help & Support"),
  terms: tr("Terms & Privacy"),
  privacyPolicy: tr("Privacy Policy"),
  termsOfUse: tr("Terms of Use"),
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
  // Signed in is the session, not the email: an Apple account can have none.
  const { email: accountEmail, session: authSession } = useAuth();
  const email = accountEmail ?? (authSession ? tr("Apple account") : null);
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
    <TwoColumns
      left={
        <>
      {saveError && (
        <View style={s.banner} accessibilityRole="alert">
          <Note tone="warn">{tr("Your last change couldn't be saved in this browser's storage. It applies until you close the page")}</Note>
        </View>
      )}

      {/* Account: signed out it invites a sign-in (optional, the app works
          without one); signed in it shows who, and opens the Account page. */}
      <PressScale
        onPress={() => (email ? open('account') : setSignInOpen(true))}
        accessibilityRole="button"
        accessibilityLabel={email ? tr("Account, signed in as {0}", [email]) : tr("Sign in to back up your items")}
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
          <Text style={s.profileTitle} numberOfLines={1}>{email ? email : tr("Sign in")}</Text>
          <Text style={s.profileSub} numberOfLines={1}>
            {email ? tr("Signed in") : tr("Back up your items to an account")}
          </Text>
        </View>
        <Ionicons name={dirIcon('chevron-forward')} size={18} color={t.textMuted} style={{ marginLeft: 4, opacity: 0.75 }} />
      </PressScale>

      <UpdateRow />
      <ProRow />

      <SettingsSection title={tr("General")}>
        <SettingsCard>
          <SettingRow icon="person-outline" accent="mint" title={tr("Profile")} description={tr("Your library and storage")} onPress={() => open('profile')} />
          <SettingRow icon="shield-checkmark-outline" accent="blue" title={tr("Privacy & Security")} description={tr("Camera access and stored data")} onPress={() => open('privacy')} />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={tr("App Preferences")}>
        <SettingsCard>
          <SettingRow icon="notifications-outline" accent="amber" title={tr("Notifications")} description={tr("Expiry reminders and timing")} onPress={() => open('notifications')} />
          <SettingRow icon="grid" accent="purple" title={tr("Categories")} description={tr("Your folders and defaults")} onPress={() => open('categories')} />
          <SettingRow icon="color-palette-outline" accent="pink" title={tr("Appearance")} description={tr("Theme, density and motion")} onPress={() => open('appearance')} />
          <PickerRow<LanguageChoice>
            icon="language-outline"
            accent="teal"
            title={tr("Language")}
            label={tr("Language")}
            value={settings.language}
            options={[
              { value: 'system', label: tr("Phone language"), sub: LANGUAGES.find((l) => l.code === phoneLanguage())?.native },
              // Each language by its own name, one line each, as language
              // pickers do: anyone can find theirs whatever is showing now.
              ...availableLanguages().map((l) => ({ value: l.code as LanguageChoice, label: l.native })),
            ]}
            onChange={(v) => {
              update({ language: v });
              applyLanguage(v);
            }}
          />
        </SettingsCard>
      </SettingsSection>
        </>
      }
      right={
        <>
      <SettingsSection title={tr("Expiry & Lists")}>
        <SettingsCard>
          <PickerRow
            icon="hourglass-outline"
            accent="mint"
            title={tr("Warning period")}
            label={tr("Warning period")}
            description={tr("Days before expiry")}
            value={settings.warningDays}
            options={WARNING_DAYS.map((d) => ({ value: d, label: tr("{0} days", [d]) }))}
            onChange={(v) => update({ warningDays: v })}
          />
          <SettingRow
            icon="cart-outline"
            accent="mint"
            title={tr("Automatic Shopping List")}
            description={tr("Adds expiring products")}
            right={<Toggle label={tr("Automatically add expiring products to the Shopping List")} value={settings.autoShoppingList} onChange={(v) => update({ autoShoppingList: v })} />}
          />
          <PickerRow
            icon="calendar-outline"
            accent="teal"
            title={tr("Date format")}
            label={tr("Date format")}
            description={formatDate(isoToday(new Date()))}
            value={settings.dateFormat}
            options={DATE_FORMATS.map((f) => ({ value: f, label: DATE_FORMAT_LABELS[f] }))}
            onChange={(v) => update({ dateFormat: v })}
          />
          <PickerRow
            icon="swap-vertical-outline"
            accent="blue"
            title={tr("Sorting")}
            label={tr("Sorting")}
            description={tr("Order items")}
            value={settings.sort}
            options={SORT_ORDERS.map((o) => ({ value: o, label: SORT_LABELS[o] }))}
            onChange={(v) => update({ sort: v })}
          />
          <SettingRow
            icon="eye-outline"
            accent="teal"
            title={tr("Show expired items")}
            description={tr("Keep past-date items visible")}
            right={<Toggle label={tr("Show expired items")} value={settings.showExpired} onChange={(v) => update({ showExpired: v })} />}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={tr("Insights")}>
        <SettingsCard>
          <SettingRow icon="leaf-outline" accent="mint" title={tr("Waste stats")} description={tr("What you used in time and what expired")} onPress={() => open('stats')} />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={tr("Data & Storage")}>
        <SettingsCard>
          <SettingRow
            icon="cloud-upload-outline"
            accent="mint"
            title={tr("Backup & Restore")}
            description={tr("Save everything to a file, or restore one")}
            onPress={() => open('backup')}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={tr("About")}>
        <SettingsCard>
          <SettingRow icon="information-circle-outline" accent="blue" title={tr("App version")} value={APP_VERSION_SHOWN} />
          <SettingRow icon="help-circle-outline" accent="teal" title={tr("Help & Support")} description={tr("Answers, and how to reach us")} onPress={() => open('help')} />
          <SettingRow icon="chatbubble-ellipses-outline" accent="mint" title={tr("Send feedback")} description={tr("Report a bug, or share feedback or an idea")} onPress={() => setFeedbackOpen(true)} />
          <SettingRow icon="document-text-outline" accent="purple" title={tr("Terms & Privacy")} onPress={() => open('terms')} />
        </SettingsCard>
      </SettingsSection>

      <SettingsCard danger>
        <SettingRow
          icon="trash-outline"
          accent="red"
          title={tr("Clear all data")}
          titleColor={accents.red}
          description={tr("Delete everything stored here")}
          onPress={() => setConfirmClear(true)}
        />
      </SettingsCard>
        </>
      }
    />
  );

  return (
    <View style={[s.root, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <Animated.View style={{ flex: 1, opacity: appear, transform: [{ translateX: rootShift }, { translateX: enterX }] }}>
        <View style={[s.frame, s.rootFrame]}>
          <View style={s.header}>
            {/* The compact 38pt glass back circle: the header's title row
                stays light, the button stops competing with it. */}
            <GlassIconButton icon="chevron-back" iconSize={20} size={38} label={tr("Go back")} onPress={() => onNavigate('tab:home')} />
            <Text style={s.headerTitle} accessibilityRole="header">
              {tr("Settings")}</Text>
            {/* The magnifier at the top right: opens the settings search sheet. */}
            <GlassIconButton icon="search" iconSize={19} size={38} label={tr("Search settings")} onPress={() => setSearchOpen(true)} />
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
                <GlassIconButton icon="chevron-back" iconSize={20} size={38} label={tr("Go back")} onPress={closePage} />
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
    { key: 'profile', title: tr("Profile"), description: tr("Your library and storage"), icon: 'person-outline', accent: 'mint', page: 'profile' },
    { key: 'privacy', title: tr("Privacy & Security"), description: tr("Camera access and stored data"), icon: 'shield-checkmark-outline', accent: 'blue', page: 'privacy' },
    { key: 'notifications', title: tr("Notifications"), description: tr("Expiry reminders and timing"), icon: 'notifications-outline', accent: 'amber', page: 'notifications' },
    { key: 'expiry-reminders', title: tr("Expiry reminders"), description: tr("Get notified before items expire"), icon: 'notifications-outline', accent: 'amber', page: 'notifications' },
    { key: 'reminder-timing', title: tr("Reminder timing"), description: tr("When a reminder appears before the expiry date"), icon: 'time-outline', accent: 'amber', page: 'notifications' },
    { key: 'daily-summary', title: tr("Daily summary"), description: tr("See what's expiring soon"), icon: 'today-outline', accent: 'amber', page: 'notifications' },
    { key: 'browser-notifications', title: WEB ? tr("Browser notifications") : tr("Notifications"), description: WEB ? tr("Allow notifications from this browser") : tr("Allow notifications on this device"), icon: 'globe-outline', accent: 'amber', page: 'notifications' },
    { key: 'categories', title: tr("Categories"), description: tr("Your folders and defaults"), icon: 'grid', accent: 'purple', page: 'categories' },
    { key: 'default-category', title: tr("Default category"), description: tr("Preselected when you add an item"), icon: 'pricetag-outline', accent: 'blue', page: 'categories' },
    { key: 'browse-categories', title: tr("Browse categories"), description: tr("The lists for the categories you keep"), icon: 'folder-open-outline', accent: 'purple', page: 'categories' },
    { key: 'appearance', title: tr("Appearance"), description: tr("Theme, density and motion"), icon: 'color-palette-outline', accent: 'pink', page: 'appearance' },
    { key: 'theme', title: tr("Theme"), description: tr("Dark, light, or follow your device"), icon: 'contrast-outline', accent: 'purple', page: 'appearance' },
    { key: 'padLayout', title: tr("Layout"), description: tr("Basic, Compact or Detailed"), icon: 'grid-outline', accent: 'blue', page: 'appearance' },
    { key: 'animations', title: tr("Animations"), description: tr("Fades, press feedback and the scanning line"), icon: 'sparkles-outline', accent: 'purple', page: 'appearance' },
    { key: 'warning-period', title: tr("Warning period"), description: tr("Days before expiry"), icon: 'hourglass-outline', accent: 'mint', page: null },
    { key: 'auto-shopping', title: tr("Automatic Shopping List"), description: tr("Adds expiring products"), icon: 'cart-outline', accent: 'mint', page: null },
    { key: 'date-format', title: tr("Date format"), description: tr("How dates are displayed"), icon: 'calendar-outline', accent: 'teal', page: null },
    { key: 'sorting', title: tr("Sorting"), description: tr("Order items"), icon: 'swap-vertical-outline', accent: 'blue', page: null },
    { key: 'show-expired', title: tr("Show expired items"), description: tr("Keep past-date items visible"), icon: 'eye-outline', accent: 'teal', page: null },
    { key: 'backup', title: tr("Backup & Restore"), description: tr("Save everything to a file, or restore one"), icon: 'cloud-upload-outline', accent: 'mint', page: 'backup' },
    { key: 'stats', title: tr("Waste stats"), description: tr("What you used in time and what expired"), icon: 'leaf-outline', accent: 'mint', page: 'stats' },
    { key: 'export', title: tr("Export data"), description: tr("Download your items as JSON or CSV"), icon: 'download-outline', accent: 'teal', page: 'backup' },
    { key: 'help', title: tr("Help & Support"), description: tr("Answers, and how to reach us"), icon: 'help-circle-outline', accent: 'teal', page: 'help' },
    { key: 'terms', title: tr("Terms & Privacy"), description: tr("Your data, camera and exports"), icon: 'document-text-outline', accent: 'purple', page: 'terms' },
    { key: 'clear-data', title: tr("Clear all data"), description: tr("Delete everything stored here"), icon: 'trash-outline', accent: 'red', page: null },
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
            <GlassIconButton icon="chevron-back" iconSize={20} size={38} label={tr("Close search")} onPress={onClose} />
            <Text style={s.detailTitle} accessibilityRole="header">
              {tr("Search settings")}</Text>
          </View>
          <SearchField value={query} onChange={setQuery} placeholder={tr("Search settings")} accessibilityLabel={tr("Search settings")} />
          <ScrollView style={s.searchScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={s.searchContent}>
              {q === '' ? (
                <Text style={s.searchHint}>{tr("Type to find a setting by name or what it does")}</Text>
              ) : results.length === 0 ? (
                <Text style={s.searchHint}>{tr("No settings match “")}{query.trim()}”</Text>
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
                        <Ionicons name={dirIcon('chevron-forward')} size={16} color={t.textMuted} />
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
      return <SupportPage appVersion={APP_VERSION} />;
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

// A newer Prexpire is on the App Store: one tap opens its page to update.
function UpdateRow() {
  const update = useStoreUpdate();
  if (!update) return null;
  return (
    <SettingsSection title={tr("Update")}>
      <SettingsCard>
        <SettingRow icon="arrow-up-circle-outline" accent="mint" title={tr("Update available")} description={tr("Prexpire {0} is on the App Store", [update.version])} value={tr("Update")} onPress={() => openStore(update.url)} />
      </SettingsCard>
    </SettingsSection>
  );
}

// Prexpire Pro: the free plan's count, or Pro's status. Shown once the
// installed app can sell Pro.
function ProRow() {
  const { available, isPro, state, openPaywall, manage } = usePro();
  const added = useMonthlyAdds();
  if (!available) return null;
  const description = state?.lifetime ? tr("Lifetime. Thank you for your support") : tr("Active. No limits on items or categories");
  return (
    <SettingsSection title={tr("Plan")}>
      <SettingsCard>
        {/* Free users see their own plan named "Free" (with its count), and
            Pro offered as the next step, so the 20 a month never reads as
            something Pro gives. */}
        {isPro ? (
          <SettingRow icon="checkmark-circle" accent="mint" title={tr("Prexpire Pro")} description={description} onPress={() => openPaywall('settings')} />
        ) : (
          <PlanUsageRow
            icon="sparkles-outline"
            accent="mint"
            title={tr("Free plan")}
            used={Math.min(added, FREE_ITEM_LIMIT)}
            limit={FREE_ITEM_LIMIT}
            countLabel={tr("{0} of {1} items this month", [Math.min(added, FREE_ITEM_LIMIT), FREE_ITEM_LIMIT])}
            resetLabel={tr("Resets {0}", [nextReset().toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })])}
            cta={tr("Get Pro")}
            onPress={() => openPaywall('settings')}
          />
        )}
        {/* Subscribers change or cancel their plan on Apple's own page; a
            lifetime purchase has nothing to manage. */}
        {isPro && !state?.lifetime ? (
          <SettingRow icon="card-outline" accent="blue" title={tr("Manage subscription")} description={tr("Change or cancel your plan in your Apple ID settings")} onPress={manage} />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

// Account: who is signed in, and signing out. Signing out keeps every item on
// this phone; it only disconnects the account.
function AccountDetail({ onSignedOut }: { onSignedOut: () => void }) {
  const s = useStyles();
  const t = useTheme();
  const { email: accountEmail, session } = useAuth();
  const email = accountEmail ?? (session ? tr("Apple account") : null);
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
      ? tr("Just now")
      : synced.toDateString() === new Date().toDateString()
        ? synced.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
        : formatDate(synced.toISOString().slice(0, 10))
    : tr("Not yet");
  const backupValue = status === 'syncing' ? tr("Backing up…") : status === 'offline' ? tr("Offline") : status === 'error' ? tr("Didn't finish") : ago;
  return (
    <>
      <View style={s.heroCard}>
        <View style={s.heroAvatar}>
          <Text style={s.avatarLetter}>{(email ?? '?')[0].toUpperCase()}</Text>
        </View>
        <Text style={s.heroTitle} numberOfLines={1}>{email ?? tr("Signed out")}</Text>
        <Text style={s.heroSub}>{since ? tr("Account since {0}", [since.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })]) : tr("Signed in")}</Text>
      </View>
      <SettingsSection title={tr("Backup and sync")}>
        <SettingsCard>
          <SettingRow icon={status === 'offline' ? 'cloud-offline-outline' : 'cloud-done-outline'} accent="mint" title={tr("Last backed up")} value={backupValue} />
          <SettingRow icon="refresh-outline" accent="teal" title={tr("Back up now")} description={tr("Also brings in changes from your other phones")} onPress={() => syncNow()} />
        </SettingsCard>
        {status === 'offline' || status === 'error' ? (
          <Note>
            {status === 'offline' ? tr("You're offline. Your items are safe on this phone, and they'll back up when you're connected.") : tr("The last backup didn't finish. It tries again on its own; you can also tap Back up now.")}
          </Note>
        ) : null}
      </SettingsSection>
      <SettingsSection title={tr("Session")}>
        <SettingsCard>
          <SettingRow icon="key-outline" accent="blue" title={tr("Change password")} description={tr("Choose a new password for this account")} onPress={() => setChangePw(true)} />
          <SettingRow
            icon="log-out-outline"
            accent="amber"
            title={busy ? tr("Signing out…") : tr("Sign out")}
            description={tr("Removes your items from this phone. They stay in your account")}
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
      <SettingsSection title={tr("Delete account")}>
        <SettingsCard>
          <SettingRow icon="trash-outline" accent="red" title={tr("Delete account")} titleColor={t.red} description={tr("Deleted for good after 30 days")} onPress={() => setDeleting(true)} />
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
        <Text style={s.heroTitle}>{tr("Preferences")}</Text>
        <Text style={s.heroSub}>{WEB ? tr("Saved in this browser") : tr("Saved on this device")}</Text>
      </View>
      <SettingsSection title={tr("Library")}>
        <SettingsCard>
          <SettingRow icon="cube-outline" accent="mint" title={tr("Items added")} value={`${saved.length}`} />
          <SettingRow icon="cart-outline" accent="mint" title={tr("Shopping list entries")} value={`${shopping.length}`} />
          <SettingRow icon="folder-open-outline" accent="blue" title={tr("Your categories")} value={`${all.length}`} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={tr("Storage")}>
        <SettingsCard>
          <SettingRow icon="server-outline" accent="teal" title={tr("Where data lives")} value={WEB ? tr("This browser") : tr("This device")} />
          <SettingRow icon="cloud-offline-outline" accent="amber" title={tr("Synced")} value={tr("Never")} />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

function PrivacyDetail({ onNavigate }: { onNavigate: (route: string) => void }) {
  return (
    <SettingsSection title={tr("Privacy & Security")}>
      <SettingsCard>
        <SettingRow
          icon="camera-outline"
          accent="teal"
          title={tr("Camera access")}
          description={
            WEB ? tr("The scanner asks your browser for the camera when you open it. Frames are read in the browser and never uploaded. To change access, use your browser's site settings") : tr("The scanner asks for the camera when you open it. Frames are read on the device and never uploaded. To change access, use the Settings app")
          }
          below={<SmallButton label={tr("Open scanner")} icon="scan-outline" onPress={() => onNavigate('scan')} />}
        />
        <SettingRow
          icon="lock-closed-outline"
          accent="mint"
          title={tr("Data storage")}
          description={
            WEB ? tr("Items, categories and settings are stored only in this browser's local storage, on this device. Nothing is uploaded, synced or backed up, and clearing your browser data removes them") : tr("Items, categories and settings are stored only on this device. Nothing is uploaded, synced or backed up.")
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
      <SettingsSection title={tr("Reminders")}>
        <SettingsCard>
          <SettingRow
            icon="notifications-outline"
            accent="amber"
            title={tr("Expiry reminders")}
            description={tr("Get notified before items expire")}
            right={<Toggle label={tr("Expiry reminders")} value={settings.reminders} onChange={(v) => update({ reminders: v })} />}
          />
          <PickerRow
            icon="time-outline"
            accent="amber"
            title={tr("Reminder timing")}
            label={tr("Reminder timing")}
            description={tr("When a reminder appears before the expiry date")}
            value={settings.reminderLead}
            options={REMINDER_LEADS.map((l) => ({ value: l, label: reminderLeadLabel(l) }))}
            onChange={(v) => update({ reminderLead: v })}
          />
          <PickerRow
            icon="alarm-outline"
            accent="amber"
            title={tr("Reminder time")}
            label={tr("Reminder time")}
            description={tr("When reminders arrive on the day")}
            value={settings.reminderHour}
            options={REMINDER_HOURS.map((h) => ({ value: h, label: reminderHourLabel(h) }))}
            onChange={(v) => update({ reminderHour: v })}
          />
          <SettingRow
            icon="trending-down-outline"
            accent="amber"
            title={tr("Earlier for what you waste")}
            description={tr("An extra heads-up for categories you often throw away, from your waste stats")}
            right={<Toggle label={tr("Earlier for what you waste")} value={settings.wasteAware} onChange={(v) => update({ wasteAware: v })} />}
          />
          <SettingRow
            icon="today-outline"
            accent="amber"
            title={tr("Daily summary")}
            description={tr("See what's expiring soon")}
            right={<Toggle label={tr("Daily summary")} value={settings.dailySummary} onChange={(v) => update({ dailySummary: v })} />}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={tr("Delivery")}>
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
    granted: tr("Allowed"),
    denied: tr("Blocked"),
    default: tr("Not set"),
    unsupported: tr("Unavailable"),
    insecure: tr("Unavailable"),
  };
  const note: Record<NotificationStatus, { text: string; tone: 'ok' | 'warn' | 'muted' }> = {
    granted: { text: tr("This browser allows PREXPIRE to show notifications. Expiry alerts appear while the app is open; nothing is delivered in the background"), tone: 'ok' },
    denied: { text: tr("Notifications are blocked for this site. To allow them, change the site's notification setting in your browser, then come back. In-app expiry alerts still appear while the app is open"), tone: 'warn' },
    default: { text: tr("Your browser will ask for permission when you select Allow. In-app expiry alerts appear while the app is open either way"), tone: 'muted' },
    unsupported: { text: WEB ? tr("This browser doesn't support web notifications. In-app expiry alerts still appear while the app is open") : tr("System notifications are not set up in this version of the app. In-app expiry alerts appear while it is open"), tone: 'muted' },
    insecure: { text: tr("Browsers only allow notifications on secure (https) pages. In-app expiry alerts still appear while the app is open"), tone: 'muted' },
  };

  const badgeTone = status === 'granted' ? 'green' : status === 'denied' ? 'amber' : 'muted';

  // Inside the iPhone app: real reminders, delivered even when it's closed.
  if (nativeReminders()) {
    const appNote: Record<NotificationStatus, { text: string; tone: 'ok' | 'warn' | 'muted' }> = {
      granted: { text: tr("Reminders are set automatically from your items and arrive even when Prexpire is closed"), tone: 'ok' },
      denied: { text: tr("Notifications are off for Prexpire. Turn them on in iPhone Settings, then come back"), tone: 'warn' },
      default: { text: tr("Allow notifications to get reminded before your items expire, even when Prexpire is closed"), tone: 'muted' },
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
        title={tr("Notifications")}
        description={tr("Expiry reminders on this iPhone")}
        right={<StatusBadge key={status} label={label[status]} tone={badgeTone} check={status === 'granted'} />}
        below={
          <>
            <FadeIn key={status}>
              <Note tone={appNote[status].tone}>{testSent ? tr("Test sent. It arrives in a few seconds, even if you close the app now") : appNote[status].text}</Note>
            </FadeIn>
            <View style={s.buttons}>
              {status === 'default' && <SmallButton label={asking ? tr("Waiting…") : tr("Allow notifications")} icon="notifications-outline" tone="mint" disabled={asking} onPress={ask} />}
              {status === 'denied' && <SmallButton label={tr("Open iPhone Settings")} icon="settings-outline" tone="mint" onPress={openNotificationSettings} />}
              {status !== 'denied' && <SmallButton label={testing ? tr("Sending…") : tr("Send a test notification")} icon="paper-plane-outline" disabled={testing} onPress={test} />}
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
      title={WEB ? tr("Browser notifications") : tr("Notifications")}
      description={WEB ? tr("Allow notifications from this browser") : tr("Allow notifications on this device")}
      right={<StatusBadge key={status} label={label[status]} tone={badgeTone} check={status === 'granted'} />}
      below={
        <>
          <FadeIn key={status}>
            <Note tone={note[status].tone}>{note[status].text}</Note>
          </FadeIn>
          {status === 'default' && (
            <FadeIn>
              <View style={s.buttons}>
                <SmallButton label={asking ? tr("Waiting for browser…") : tr("Allow notifications")} icon="notifications-outline" tone="mint" disabled={asking} onPress={ask} />
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
      <SettingsSection title={tr("Your categories")}>
        <SettingsCard>
          <SettingRow
            icon="folder-open-outline"
            accent="blue"
            title={tr("Your categories")}
            description={tr("The built-ins you keep and the folders you add, all in one place")}
            below={<CategoryManager />}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={tr("Defaults")}>
        <SettingsCard>
          <PickerRow<DefaultCategory>
            icon="pricetag-outline"
            accent="blue"
            title={tr("Default category")}
            label={tr("Default category")}
            description={tr("Preselected when you add an item")}
            value={settings.defaultCategory}
            onChange={(v) => update({ defaultCategory: v })}
            options={[{ value: 'last', label: tr("Last used") }, ...all.map((cat) => ({ value: cat.id as DefaultCategory, label: cat.name }))]}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={tr("Browse")}>
        <SettingsCard>
          <SettingRow icon="grid" accent="purple" title={tr("Browse categories")} description={tr("The lists for the categories you keep")} onPress={() => onNavigate('tab:items')} />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

function AppearanceDetail() {
  const { settings, update, systemReduceMotion } = useSettings();
  const { pad } = useDensity();
  return (
    <SettingsSection title={tr("Appearance")}>
      <SettingsCard>
        <PickerRow
          icon="contrast-outline"
          accent="purple"
          title={tr("Theme")}
          label={tr("Theme")}
          description={tr("Dark, light, or follow your device")}
          value={settings.theme}
          options={THEME_MODES.map((m) => ({ value: m, label: THEME_LABELS[m] }))}
          onChange={(v) => update({ theme: v, themeChosen: true })}
          below={
            <FadeIn key={settings.theme}>
              <Note>
                {settings.theme === 'system' ? tr("System follows your device’s appearance and switches live") : settings.theme === 'light' ? tr("A bright take on the same design") : tr("The classic near-black look")}
              </Note>
            </FadeIn>
          }
        />
<PickerRow
          icon="grid-outline"
          accent="blue"
          title={tr("Layout")}
          label={tr("Layout")}
          description={tr("How much each screen shows at once")}
          value={settings.padLayout}
          options={PAD_LAYOUTS.map((m) => ({ value: m, label: PAD_LAYOUT_LABELS[m] }))}
          onChange={(v) => update({ padLayout: v })}
          below={
            <FadeIn key={settings.padLayout}>
              <Note>
                {settings.padLayout === 'basic' ? tr("One column with only what’s coming up, in bigger rows") : settings.padLayout === 'detailed' ? pad ? tr("More on screen: shorter rows with dates, extra columns") : tr("More on screen: shorter rows with dates") : pad ? tr("Categories and your list side by side") : tr("Categories and your list")}
              </Note>
            </FadeIn>
          }
        />
        <SettingRow
          icon="sparkles-outline"
          accent="purple"
          title={tr("Animations")}
          description={tr("Fades and press feedback")}
          right={<Toggle label={tr("Animations")} value={settings.animations && !systemReduceMotion} disabled={systemReduceMotion} onChange={(v) => update({ animations: v })} />}
          below={systemReduceMotion ? <FadeIn><Note>{tr("Your device asks for reduced motion, so animations stay off")}</Note></FadeIn> : undefined}
        />
        <SettingRow
          icon="scan-outline"
          accent="mint"
          title={tr("Scanning Line Animation")}
          description={tr("Show or hide the moving scanning line during product scanning")}
          right={<Toggle label={tr("Scanning Line Animation")} value={settings.scanLineAnimation} onChange={(v) => update({ scanLineAnimation: v })} />}
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
      setExportError(tr("The file could not be created. Your browser may be blocking downloads on this page."));
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
      setBackupNote({ tone: 'ok', text: tr("Backup file created. Keep it somewhere safe, such as iCloud Drive or Files.") });
    } catch {
      setBackupNote({ tone: 'warn', text: tr("The backup file couldn't be created here.") });
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
      setBackupNote({ tone: 'warn', text: tr("The backup couldn't be restored. Nothing was changed.") });
    }
  };
  return (
    <>
      <SettingsSection title={tr("Backup")}>
        <SettingsCard>
          <SettingRow
            icon="archive-outline"
            accent="mint"
            title={tr("Save a backup")}
            description={tr("Items, categories, settings, Shopping List and stats, in one file")}
            below={
              <View style={s.buttons}>
                <SmallButton label={tr("Save backup")} icon="download-outline" tone="mint" onPress={() => void saveBackup()} />
              </View>
            }
          />
          <SettingRow
            icon="refresh-circle-outline"
            accent="blue"
            title={tr("Restore a backup")}
            description={tr("Replaces everything here with the backup's contents")}
            below={
              <>
                {pending ? (
                  <>
                    <Note tone="warn">
                      {tr("Restore {0} {1}{2}? What is here now will be replaced.", [pending.items, pending.items === 1 ? 'item' : 'items', pending.createdAt ? ` saved ${new Date(pending.createdAt).toLocaleDateString()}` : ''])}
                    </Note>
                    <View style={s.buttons}>
                      <SmallButton wide label={tr("Cancel")} onPress={() => setPending(null)} />
                      <SmallButton wide label={tr("Restore")} icon="refresh-outline" tone="mint" onPress={() => void restore()} />
                    </View>
                  </>
                ) : (
                  <View style={s.buttons}>
                    <SmallButton label={tr("Choose file")} icon="folder-open-outline" onPress={pickBackup} />
                  </View>
                )}
                {backupNote && <Note tone={backupNote.tone === 'warn' ? 'warn' : undefined}>{backupNote.text}</Note>}
              </>
            }
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={tr("Sync")}>
        <SettingsCard>
          <SettingRow
            icon="cloud-offline-outline"
            accent="mint"
            title={tr("Sync")}
            description={WEB ? tr("PREXPIRE has no cloud: items, categories and settings live only in this browser, on this device") : tr("PREXPIRE has no cloud: items, categories and settings live only on this device")}
            right={<StatusBadge label={tr("Off")} />}
          />
          <SettingRow
            icon="download-outline"
            accent="teal"
            title={tr("Export data")}
            description={saved.length ? tr("Download your {0} added {1}: name, category, expiry date, date precision, when added and source", [saved.length, saved.length === 1 ? 'item' : 'items']) : tr("Nothing to export yet. Items you add will be exported here (sample items are not included)")}
            below={
              <>
                <View style={s.buttons}>
                  <SmallButton label="JSON" icon="code-slash-outline" disabled={!saved.length} onPress={() => exportAs('json')} accessibilityLabel={tr("Export items as JSON")} />
                  <SmallButton label="CSV" icon="document-text-outline" disabled={!saved.length} onPress={() => exportAs('csv')} accessibilityLabel={tr("Export items as CSV")} />
                </View>
                {exportError && <Note tone="warn">{exportError}</Note>}
              </>
            }
          />
        </SettingsCard>
      </SettingsSection>
      <Note>{tr("To keep a copy, export before clearing your browser data or moving devices")}</Note>
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
  const MONTH = [tr("Jan"), tr("Feb"), tr("Mar"), tr("Apr"), tr("May"), tr("Jun"), tr("Jul"), tr("Aug"), tr("Sep"), tr("Oct"), tr("Nov"), tr("Dec")];
  const soon = saved.filter((i) => {
    const d = Math.round((new Date(i.expiresOn).getTime() - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    return d >= 0 && d <= warning(i.category);
  }).length;
  const pct = (t: Tally) => {
    const p = usedInTime(t);
    return p === null ? '–' : `${Math.round(p * 100)}%`;
  };
  // One split bar: the used share in green, the expired share in red.
  const split = (tl: Tally, height = 10) => {
    const judged = tl.used + tl.expired;
    return (
      <View style={[s.split, { height, borderRadius: height / 2 }]}>
        {judged > 0 && tl.used > 0 ? <View style={{ flex: tl.used, backgroundColor: c.green, borderRadius: height / 2 }} /> : null}
        {judged > 0 && tl.expired > 0 ? <View style={{ flex: tl.expired, backgroundColor: c.red, borderRadius: height / 2 }} /> : null}
      </View>
    );
  };
  const rates = months.map((m) => usedInTime(m.tally));
  const first = rates.find((r) => r !== null);
  const last = rates[rates.length - 1];
  const firstMonth = months[rates.findIndex((r) => r !== null)];
  const trend =
    first != null && last != null && firstMonth && firstMonth.key !== months[months.length - 1].key && Math.round(first * 100) !== Math.round(last * 100)
      ? tr("{0} from {1}% in {2}", [last > first ? 'Up' : 'Down', Math.round(first * 100), MONTH[firstMonth.month]])
      : null;
  // On a wide landscape screen: this month and the chart on the left, the
  // totals and the categories on the right.
  return (
    <>
      <TwoColumns
        left={
          <>
      <SettingsSection title={tr("This month")}>
        <View style={s.wsHero} accessible accessibilityLabel={tr("{0} used in time this month. {1} used, {2} expired.", [pct(thisMonth), thisMonth.used, thisMonth.expired])}>
          <View style={s.wsHeroRow}>
            <Text style={[s.wsHeroValue, { color: usedInTime(thisMonth) === null ? c.textMuted : c.green }]}>{pct(thisMonth)}</Text>
            <Text style={s.wsHeroLabel}>{tr("used in time")}</Text>
          </View>
          {split(thisMonth, 12)}
          <Text style={s.wsHeroSub}>
            {thisMonth.used + thisMonth.expired > 0 ? tr("{0} used  ·  {1} expired", [thisMonth.used, thisMonth.expired]) : tr("Nothing used or expired yet this month.")}
          </Text>
        </View>
      </SettingsSection>
      <SettingsSection title={tr("Used in time, last 6 months")}>
        <SettingsCard>
          {/* One child, so the card draws no divider inside the chart. */}
          <View>
          <View style={s.chart} accessibilityLabel={tr("Share of items used in time, per month")}>
            {months.map((m, i) => {
              const r = rates[i];
              const current = i === months.length - 1;
              return (
                <View key={m.key} style={s.chartCol}>
                  <Text style={[s.chartValue, current && { color: c.text }]}>{r === null ? '–' : `${Math.round(r * 100)}%`}</Text>
                  <View style={s.chartTrack}>
                    {r !== null ? <View style={[s.chartFill, { height: `${Math.max(4, r * 100)}%`, backgroundColor: current ? c.mint : c.green, opacity: current ? 1 : 0.55 }]} /> : null}
                  </View>
                  <Text style={[s.chartLabel, current && { color: c.text }]}>{MONTH[m.month]}</Text>
                </View>
              );
            })}
          </View>
          {trend ? <Text style={s.trend}>{trend}</Text> : <View style={{ height: 14 }} />}
          </View>
        </SettingsCard>
      </SettingsSection>
          </>
        }
        right={
          <>
      <SettingsSection title={tr("All time")}>
        <SettingsCard>
          <SettingRow icon="checkmark-done" accent="mint" title={tr("Used in time")} value={pct(total)} />
          <SettingRow icon="restaurant-outline" accent="teal" title={tr("Items used")} value={String(total.used)} />
          <SettingRow icon="trash-outline" accent="red" title={tr("Expired before use")} value={String(total.expired)} />
          <SettingRow icon="time-outline" accent="amber" title={tr("Expiring soon now")} value={String(soon)} />
        </SettingsCard>
      </SettingsSection>
      {entries.length > 0 && (
        <SettingsSection title={tr("By category")}>
          <SettingsCard>
            {byCategory(entries).map((row, i) => (
              <View key={row.category} style={[s.catRow, i > 0 && s.catRowLine]}>
                <View style={s.catHead}>
                  <Text style={s.catName} numberOfLines={1}>{nameOf(row.category)}</Text>
                  <Text style={s.catPct}>{pct(row.tally)}</Text>
                </View>
                {split(row.tally, 6)}
                <Text style={s.catSub}>{tr("{0} used  ·  {1} expired", [row.tally.used, row.tally.expired])}</Text>
              </View>
            ))}
          </SettingsCard>
        </SettingsSection>
      )}
          </>
        }
      />
      <Note>
        {entries.length ? tr("Use \"Mark as consumed\" when you finish something: it counts as used. Anything past its date counts as expired, whether it's still in your list or removed.") : tr("Nothing yet. Use \"Mark as consumed\" in an item's menu when you finish it; anything past its date counts as expired.")}
      </Note>
    </>
  );
}


function TermsDetail({ openPage }: { openPage: (p: PageId) => void }) {
  const s = useStyles();
  return (
    <>
      <SettingsSection title={tr("Documents")}>
        <SettingsCard>
          <SettingRow icon="shield-checkmark-outline" accent="mint" title={tr("Privacy Policy")} description={tr("Last updated {0}", [legal.privacy.updated])} onPress={() => openPage('privacyPolicy')} />
          <SettingRow icon="document-text-outline" accent="blue" title={tr("Terms of Use")} description={tr("Last updated {0}", [legal.terms.updated])} onPress={() => openPage('termsOfUse')} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={tr("In short")}>
        <SettingsCard>
          <SettingRow
            icon="phone-portrait-outline"
            accent="teal"
            title={tr("Your data")}
            description={tr("Stored on this phone. With an optional account, a copy is backed up so it's the same on your other phones")}
          />
          <SettingRow icon="camera-outline" accent="teal" title={tr("Camera")} description={tr("Labels are read on the phone; images are never uploaded or kept")} />
          <SettingRow icon="barcode-outline" accent="purple" title={tr("Barcodes")} description={tr("Only the barcode number is sent to product databases, to find the name")} />
          <SettingRow icon="eye-off-outline" accent="purple" title={tr("No ads, no tracking")} description={tr("Questions: {0}", [legal.contact])} />
        </SettingsCard>
      </SettingsSection>
      <View style={s.aboutFooter}>
        <Brandmark height={35} />
        <Text style={s.aboutTagline}>{tr("Keep track of what matters before it expires.")}</Text>
        <Text style={s.aboutVersion}>{tr("Version")}{' '}{APP_VERSION_SHOWN}</Text>
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
      <Text style={s.legalUpdated}>{tr("Last updated")}{' '}{doc.updated}</Text>
      <View style={s.legalShort}>
        <Text style={s.legalShortTitle}>{tr("The short version")}</Text>
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
      <Text style={s.legalFoot}>{tr("Also at prexpire.com/")}{doc === legal.privacy ? 'privacy' : 'terms'}</Text>
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
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onCancel} accessibilityLabel={tr("Close")} importantForAccessibility="no" />
        <View style={[s.dialog, { backgroundColor: t.dialogBg, borderColor: t.dangerBorder }]} accessibilityRole={'dialog' as never} accessibilityLabel={tr("Clear all data")} {...({ 'aria-modal': true } as object)}>
          <IconTile icon="trash-outline" accent="red" size={48} />
          <Text style={s.dialogTitle} accessibilityRole="header">
            {tr("Clear all data?")}</Text>
          <Text style={s.dialogText}>{tr("This permanently deletes from")}{' '}{WEB ? tr("this browser") : tr("this device")}:</Text>
          <View style={s.dialogList}>
            <Text style={s.dialogText}>•  {itemCount === 1 ? tr("1 item you added") : tr("{0} items you added", [itemCount])}</Text>
            <Text style={s.dialogText}>•  {listCount === 1 ? tr("1 Shopping List entry") : tr("{0} Shopping List entries", [listCount])}</Text>
            {categoryCount > 0 && (
              <Text style={s.dialogText}>•  {categoryCount === 1 ? tr("1 category you added") : tr("{0} categories you added", [categoryCount])}</Text>
            )}
            <Text style={s.dialogText}>{tr("•  Every setting on this page (back to the defaults)")}</Text>
            <Text style={s.dialogText}>{tr("•  The remembered last-used category and expiration events")}</Text>
          </View>
          <Text style={s.dialogMuted}>{tr("This can't be undone; export your items first if you want a copy")}</Text>
          {error && <Note tone="warn">{tr("Nothing could be deleted because this browser's storage refused the change. Try again")}</Note>}
          <View style={s.dialogButtons}>
            <SmallButton wide label={tr("Cancel")} onPress={onCancel} disabled={busy} />
            <SmallButton wide label={busy ? tr("Deleting…") : tr("Delete everything")} icon="trash-outline" tone="danger" onPress={confirm} disabled={busy} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  frame: { width: '100%', alignSelf: 'center' },
  // As wide as the other pages on iPad (up to 1240 pt in landscape).
  rootFrame: { maxWidth: 1240, paddingHorizontal: 16 },
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
  // Waste stats: one headline number, one split bar, one chart series.
  wsHero: { borderRadius: 20, borderWidth: 1, borderColor: t.surfaceBorder, backgroundColor: t.surface, padding: 18, gap: 12 },
  wsHeroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  wsHeroValue: { fontSize: 52, lineHeight: 56, fontWeight: '800', letterSpacing: -1.5 },
  wsHeroLabel: { color: t.textBody, fontSize: 16, fontWeight: '600' },
  wsHeroSub: { color: t.textMuted, fontSize: 14, fontWeight: '600' },
  split: { flexDirection: 'row', gap: 3, backgroundColor: t.surfaceBorder, overflow: 'hidden' },
  statLabel: { color: t.textMuted, fontSize: 12.5, fontWeight: '600' },
  chart: { flexDirection: 'row', alignItems: 'stretch', gap: 10, height: 190, paddingHorizontal: 16, paddingTop: 16 },
  chartCol: { flex: 1, alignItems: 'center', gap: 7 },
  chartValue: { color: t.textMuted, fontSize: 12, fontWeight: '700' },
  chartTrack: { flex: 1, alignSelf: 'stretch', borderRadius: 8, backgroundColor: t.cardAlt, justifyContent: 'flex-end', overflow: 'hidden' },
  chartFill: { width: '100%', borderRadius: 8 },
  chartLabel: { color: t.textMuted, fontSize: 12, fontWeight: '600' },
  trend: { color: t.textMuted, fontSize: 13.5, fontWeight: '600', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14 },
  catRow: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  catRowLine: { borderTopWidth: 1, borderTopColor: t.separator },
  catHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  catName: { color: t.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  catPct: { color: t.text, fontSize: 16, fontWeight: '800' },
  catSub: { color: t.textMuted, fontSize: 13, fontWeight: '600' },
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
  dialogButtons: { flexDirection: 'row', gap: 10, marginTop: 8 },
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
