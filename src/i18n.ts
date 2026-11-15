// Translations for the whole app.
//
// Every piece of text in the app goes through tr('English text'). The English
// sentence itself is the key, so English needs no file and a missing
// translation simply shows English. Placeholders are {0}, {1}… (or names) and
// are filled from the second argument: tr('{0} days', [n]).
//
// The language is chosen once, synchronously, when this module loads: the
// person's choice in Settings (read straight from storage) or else the phone's
// language. Lists of text that screens build at load time are then already in
// the right language. Changing the language reloads the app, so everything is
// rebuilt in the new one (see setLanguage).
//
// Only languages whose translation is complete are offered (TRANSLATIONS);
// the rest of LANGUAGES waits for its file.

import he from './locales/he.ts';
import ro from './locales/ro.ts';
import ru from './locales/ru.ts';

export type LanguageCode =
  | 'en' | 'ro' | 'he' | 'ru' | 'de' | 'fr' | 'es' | 'it' | 'pt' | 'pl' | 'nl' | 'sv' | 'cs' | 'bg' | 'uk' | 'tr'
  | 'ar' | 'ja' | 'ko' | 'zh-Hans' | 'zh-Hant';

// Each language in its own name (what people look for in a list), with the
// English name for the line underneath.
export const LANGUAGES: { code: LanguageCode; native: string; english: string; rtl?: boolean }[] = [
  { code: 'en', native: 'English', english: 'English' },
  { code: 'ro', native: 'Română', english: 'Romanian' },
  { code: 'he', native: 'עברית', english: 'Hebrew', rtl: true },
  { code: 'ru', native: 'Русский', english: 'Russian' },
  { code: 'de', native: 'Deutsch', english: 'German' },
  { code: 'fr', native: 'Français', english: 'French' },
  { code: 'es', native: 'Español', english: 'Spanish' },
  { code: 'it', native: 'Italiano', english: 'Italian' },
  { code: 'pt', native: 'Português', english: 'Portuguese' },
  { code: 'pl', native: 'Polski', english: 'Polish' },
  { code: 'nl', native: 'Nederlands', english: 'Dutch' },
  { code: 'sv', native: 'Svenska', english: 'Swedish' },
  { code: 'cs', native: 'Čeština', english: 'Czech' },
  { code: 'bg', native: 'Български', english: 'Bulgarian' },
  { code: 'uk', native: 'Українська', english: 'Ukrainian' },
  { code: 'tr', native: 'Türkçe', english: 'Turkish' },
  { code: 'ar', native: 'العربية', english: 'Arabic', rtl: true },
  { code: 'ja', native: '日本語', english: 'Japanese' },
  { code: 'ko', native: '한국어', english: 'Korean' },
  { code: 'zh-Hans', native: '简体中文', english: 'Chinese (Simplified)' },
  { code: 'zh-Hant', native: '繁體中文', english: 'Chinese (Traditional)' },
];

// The finished translations. A language is offered only once it is here.
const TRANSLATIONS: Partial<Record<LanguageCode, Record<string, string>>> = {
  ro,
  he,
  ru,
};

export function availableLanguages() {
  return LANGUAGES.filter((l) => l.code === 'en' || TRANSLATIONS[l.code]);
}

// The person's choice: 'system' follows the phone.
export type LanguageChoice = 'system' | LanguageCode;
const SETTINGS_KEY = 'prexpire.settings.v1';

// The phone's language as a supported code. The iPhone app passes the phone's
// languages in (window.__prexpireLocales) because the web view only reports
// the languages the app itself declares.
export function phoneLanguage(): LanguageCode {
  const w = typeof window !== 'undefined' ? (window as { __prexpireLocales?: string[]; navigator?: Navigator }) : undefined;
  const tags = [...(w?.__prexpireLocales ?? []), ...(w?.navigator?.languages ?? []), w?.navigator?.language ?? ''].filter(Boolean);
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (lower.startsWith('zh')) {
      const code: LanguageCode = /hant|tw|hk|mo/.test(lower) ? 'zh-Hant' : 'zh-Hans';
      if (TRANSLATIONS[code]) return code;
      continue;
    }
    const base = (lower.split(/[-_]/)[0] === 'iw' ? 'he' : lower.split(/[-_]/)[0]) as LanguageCode;
    if (base === 'en') return 'en';
    if (TRANSLATIONS[base]) return base;
  }
  return 'en';
}

function storedChoice(): LanguageChoice {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_KEY) : null;
    const v = raw ? (JSON.parse(raw) as { language?: unknown }).language : undefined;
    if (v === 'system') return 'system';
    if (typeof v === 'string' && LANGUAGES.some((l) => l.code === v) && (v === 'en' || TRANSLATIONS[v as LanguageCode])) return v as LanguageCode;
  } catch {
    // Unreadable storage: follow the phone.
  }
  return 'system';
}

function resolve(choice: LanguageChoice): LanguageCode {
  return choice === 'system' ? phoneLanguage() : choice;
}

let current: LanguageCode = resolve(storedChoice());
let table: Record<string, string> | undefined = TRANSLATIONS[current];

export function language(): LanguageCode {
  return current;
}
export function isRTL(code: LanguageCode = current): boolean {
  return !!LANGUAGES.find((l) => l.code === code)?.rtl;
}

// The page reads right to left for Hebrew and Arabic.
if (typeof document !== 'undefined') {
  document.documentElement.lang = current;
  document.documentElement.dir = isRTL() ? 'rtl' : 'ltr';
  // Text that is itself English (product names people typed) would line up
  // on the left inside a right-to-left screen; it follows the screen's right
  // edge instead. :where() keeps this weaker than any alignment a screen sets
  // on purpose (centred titles stay centred).
  if (isRTL()) {
    const style = document.createElement('style');
    style.textContent = ':where(html[dir="rtl"] [dir="auto"]){text-align:right}';
    document.head.appendChild(style);
  }
}

type Vars = (string | number)[] | Record<string, string | number>;

export function tr(english: string, vars?: Vars): string {
  let out = (table && table[english]) || english;
  if (vars) {
    out = out.replace(/\{(\w+)\}/g, (m, k: string) => {
      const v = Array.isArray(vars) ? vars[Number(k)] : vars[k];
      return v === undefined ? m : String(v);
    });
  }
  return out;
}

// Saves nothing itself (Settings stores the choice); applies it by reloading
// once the setting is written, so every screen is rebuilt in the new language.
export function applyLanguage(choice: LanguageChoice) {
  const next = resolve(choice);
  if (next === current) return;
  if (typeof window !== 'undefined' && window.location) setTimeout(() => window.location.reload(), 120);
}

// Arrows that mean "back" and "forward" point the other way in Hebrew and
// Arabic: chevron-back <-> chevron-forward, arrow-back <-> arrow-forward.
export function dirIcon<T extends string>(name: T): T {
  if (!isRTL()) return name;
  return name.replace(/-(forward|back)\b/, (m) => (m === '-forward' ? '-back' : '-forward')) as T;
}

// The locale for dates and numbers (Intl), matching the app's language.
// Locale for dates and times: the phone's own for English (keeps its
// day/month order), otherwise the app language.
export function dateLocale(): string | undefined {
  return current === 'en' ? undefined : intlLocale();
}

export function intlLocale(): string {
  return current === 'zh-Hans' ? 'zh-CN' : current === 'zh-Hant' ? 'zh-TW' : current === 'pt' ? 'pt-BR' : current;
}
