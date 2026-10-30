import { Image } from 'react-native';
import { type Item } from '../items';
import { useCategories } from '../categories';
import { daysUntil } from '../scanner/dateParser';
import { expiryStatus } from '../preferences';
import { useSettings } from '../settings';
import { ExpiryRow } from './HomeComponents';
import { categoryArt } from './ResultSheet';

// Every tracked item's row art is its category's illustration; the category
// tile art is shared so a row always matches the tile it came from. A scanned
// product with a retrieved photo shows the photo instead, so the real product
// is what the user sees wherever the item appears.
export function itemArt(item: Item, size = 30) {
  return categoryArt(item.category, size);
}

// The row's art node: the product's own photo when it has one, otherwise the
// category illustration. `wide`/`tall`/`round` match the row icon tile so the
// photo fills it exactly (compact and regular rows have different tiles).
export function itemRowArt(item: Item, compact: boolean) {
  if (item.image) {
    return (
      <Image
        source={{ uri: item.image }}
        style={compact ? { width: 36, height: 32, borderRadius: 10 } : { width: 44, height: 42, borderRadius: 12 }}
        resizeMode="cover"
        accessibilityLabel={`${item.name} product photo`}
        accessibilityRole="image"
      />
    );
  }
  return categoryArt(item.category, compact ? 24 : 30);
}

// Amber from today through the warning period chosen in Settings, green after that.
export function itemPill(item: Item, warningDays: number, today = new Date()) {
  const status = expiryStatus(item.expiresOn, warningDays, today);
  if (status === 'expired') return { pill: 'Expired', tone: 'amber' as const };
  const days = daysUntil(item.expiresOn, today);
  const pill = days === 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`;
  return { pill, tone: status === 'soon' ? ('amber' as const) : ('green' as const) };
}

type Props = {
  item: Item;
  // Adds the formatted expiry date to the subtitle.
  showDate?: boolean;
  // Replaces the category subtitle, e.g. "Reminder on 03/11/2026".
  note?: string;
  onPress?: () => void;
};

// An item in a list, styled by the Settings preferences (compact rows, warning period, date format).
// The days-left pill already says how long is left, so the subtitle carries
// ONLY the category — never a repeated "Expires in N days" phrase.
export function ItemRow({ item, showDate = false, note, onPress }: Props) {
  const { settings, formatDate } = useSettings();
  const { nameOf } = useCategories();
  const { pill, tone } = itemPill(item, settings.warningDays);
  const sub = note ? [note] : [nameOf(item.category)];
  if (showDate) sub.push(formatDate(item.expiresOn, item.datePrecision));
  return (
    <ExpiryRow
      art={itemRowArt(item, settings.compact)}
      title={item.name}
      sub={sub}
      pill={pill}
      tone={tone}
      compact={settings.compact}
      onPress={onPress}
    />
  );
}
