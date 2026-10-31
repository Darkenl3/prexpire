import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, withAlpha, radius } from '../theme';

// Offline awareness for the scanner screens. The ONLY thing the app needs the
// network for is the online barcode lookup: everything the user already saved
// (items, shopping list, reminders, settings) lives in local storage, and
// manual entry works with no connection at all. So the offline state is shown
// as a small, friendly, auto-hiding note — never a blocking error screen, and
// never a dialog. It appears only where the network is actually relevant
// (the scanner), only while navigator.onLine is false, and disappears the
// moment connectivity returns.
export function useOffline(): boolean {
  const [offline, setOffline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine === false : false));
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return offline;
}

// The note itself: one pill, the theme's own surface, a cloud-offline glyph
// and one complete sentence. Two lines max on the narrowest phones; no
// ellipsis, no em dash.
export function OfflineNotice() {
  const t = useTheme();
  const offline = useOffline();
  if (!offline) return null;
  return (
    <View
      style={[styles.pill, { backgroundColor: withAlpha(t.text, 0.07), borderColor: withAlpha(t.text, 0.14) }]}
      accessibilityRole="text"
      accessibilityLabel="You're offline. Your saved items are still available."
    >
      <Ionicons name="cloud-offline-outline" size={14} color={t.mint} />
      <Text style={[styles.text, { color: t.text }]} numberOfLines={2}>
        You're offline. Your saved items are still available.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 8,
    marginHorizontal: 16,
  },
  text: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '500',
    flexShrink: 1,
  },
});
