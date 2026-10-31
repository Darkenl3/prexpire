import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles } from '../theme';
import { useLayout } from '../layout';
import { NAV_HEIGHT, navOffset, type TabId } from './HomeComponents';
import { AutohideHeader, HEADER_HEIGHT, NO_RUBBER_BAND, useNavAutohide } from './navAutohide';
import { TabTransition } from './TabTransition';
import { AlertSpacer } from './ExpiryAlert';

type Props = {
  // Which tab this screen is - drives the shared enter transition (a gentle
  // fade plus a very small slide in from the side the user came from).
  tab: TabId;
  // The section's name, shown IN the header strip - the Settings structure:
  // the title lives in the header, so the strip and the body enter as ONE
  // screen (the strip rides the same tab transition as the content below).
  title: string;
  subtitle?: string;
  badge: number;
  // Narrower than Home: lists and settings read better at a limited width.
  maxWidth?: number;
  // An optional control at the right edge of the title block (the Lists
  // screen's "Add item" capsule). Vertically centered on the subtitle
  // lead-in, like the reference's prominent mint action button.
  headerAction?: ReactNode;
  // Tighter title spacing so the Lists tab fits more products above the
  // fold (the reference's compact header rhythm).
  dense?: boolean;
  onNavigate: (route: string) => void;
  children: ReactNode;
};

// The frame shared by the Items and Reminders tabs: the header strip (Home's
// wordmark or this section's title) rides the tab transition WITH the
// scrolling body, so the whole screen - title and content together - enters
// as one, exactly like Settings' own unified fade; below it, the lead-in row
// and a scrolling body that leaves room for the floating bottom nav.
export function Page({ tab, title, subtitle, badge, maxWidth = 720, headerAction, dense = false, onNavigate, children }: Props) {
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const c = useStyles();
  // YouTube-style: ONLY the header hides while scrolling down (the bottom
  // navigation is permanent).
  const { hidden, onScroll } = useNavAutohide();
  const frame = { maxWidth: Math.min(layout.maxContentWidth, maxWidth), paddingHorizontal: layout.gutter };
  return (
    <View style={[c.root, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
      {/* The tab-switch transition wraps the header AND the body: the strip's
          title IS this section's title, so both enter as ONE screen - the
          same unified fade Settings has always had (its own header rides its
          fade the same way). The header still overlays the content (see
          navAutohide.tsx): hiding it on scroll never resizes the scroller, so
          the content never jumps mid-gesture. */}
      <TabTransition tab={tab}>
        <AutohideHeader
          hidden={hidden}
          badge={badge}
          title={title}
          gutter={layout.gutter}
          maxWidth={Math.min(layout.maxContentWidth, maxWidth)}
          onMenu={() => onNavigate('tab:settings')}
          onBell={() => onNavigate('tab:reminders')}
        />
        <ScrollView
          style={[c.scroll, NO_RUBBER_BAND]}
          onScroll={onScroll}
          contentContainerStyle={{ paddingTop: HEADER_HEIGHT, paddingBottom: NAV_HEIGHT + navOffset(insets.bottom) + 24 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={[c.frame, frame]}>
            <AlertSpacer />
            {/* The lead-in row: the subtitle (the title itself now lives in
                the header strip above, exactly like Settings - never shown
                twice) beside the section's action capsule. */}
            {(!!subtitle || headerAction) && (
              <View style={[c.titleBlock, dense && c.titleBlockDense]}>
                <View style={c.titleRow}>
                  <View style={c.titleText}>{!!subtitle && <Text style={c.subtitle}>{subtitle}</Text>}</View>
                  {headerAction}
                </View>
              </View>
            )}
            {children}
          </View>
        </ScrollView>
      </TabTransition>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  frame: { width: '100%', alignSelf: 'center' },
  scroll: { flex: 1 },
  // The lead-in row's spacing (the title itself lives in the header strip
  // now, so this block is the subtitle + the section's action capsule).
  titleBlock: { marginTop: 6, marginBottom: 18 },
  // The Lists tab's tighter rhythm: the subtitle sits close to the header
  // as ONE visual group, with clear breathing room before the next
  // section (the Items / Shopping List segmented control) — the reference's
  // compact header beat.
  titleBlockDense: { marginTop: 2, marginBottom: 20 },
  // The subtitle and its optional right-side action ("Add item") share one
  // row; the text column shrinks first so the action never wraps or clips.
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleText: { flex: 1, minWidth: 0 },
  // The subtitle hugs the header (one visual group above the content), so
  // the pair reads as a single block before the gap that separates it from
  // the content below.
  subtitle: { color: c.textMuted, fontSize: 15, marginTop: 2 },
}));
