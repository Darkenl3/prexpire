# Native WebView shell (Expo Go / React Native)

This repo's app runs on the web at **https://prexpire.vercel.app/**. The web build
has a working in-browser scanner (camera + Tesseract WASM), but inside a native
WebView the browser camera is often blocked (iOS WKWebView) and Tesseract is
weaker than the native engines.

This document wires a React Native shell around the website so the scan runs
**natively** — Apple Vision on iOS / Google ML Kit on Android via
`expo-text-extractor` — and hands the reading back to the web app, which parses
it with its own date parser and opens the save sheet pre-filled.

The web app already contains the bridge (both directions):

- Tapping the web app's **Scan** button inside the shell posts
  `{ "type": "scan" }` through `window.ReactNativeWebView.postMessage` — the
  shell opens its native scanner instead of the web one.
- The shell dispatches `window.dispatchEvent(new CustomEvent('prexpire:native-scan',
  { detail: { lines: [...] } }))` via `injectJavaScript` — the web app parses the
  lines and opens the scanner's save sheet with the detected date.

## Shell setup

```bash
npx expo install expo-camera expo-text-extractor expo-glass-effect
```

> **Important:** `expo-text-extractor` is native code and is **not included in
> the Expo Go binary** — the better OCR engine needs a development build:
>
> ```bash
> eas build --profile development --platform ios     # or android
> # or locally:
> npx expo run:ios
> ```
>
> In pure Expo Go the shell below falls back to a notice (native OCR unavailable).
> `expo-glass-effect` needs iOS 26+; on Android/older iOS `GlassView`
> renders as a plain `View` — safe no-op.

## `index.tsx` (the shell)

```tsx
import { useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { NativeScanner } from './NativeScanner';

const SITE = 'https://prexpire.vercel.app/';

export default function HomeScreen() {
  const web = useRef<WebView>(null);
  const [scanning, setScanning] = useState(false);

  // The web app's own Scan button asks the shell to scan natively.
  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg?.type === 'scan') setScanning(true);
    } catch {
      // Not ours; ignore.
    }
  };

  // The native scanner read the label: hand the lines to the web app.
  const onScanned = (lines: string[]) => {
    setScanning(false);
    web.current?.injectJavaScript(
      `window.dispatchEvent(new CustomEvent('prexpire:native-scan',{detail:${JSON.stringify({ lines })}}));true;`,
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <WebView
        ref={web}
        source={{ uri: SITE }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        allowsBackForwardNavigationGestures
        startInLoadingState
        onMessage={onMessage}
      />
      {scanning && <NativeScanner onClose={() => setScanning(false)} onScanned={onScanned} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080D0C' },
  webview: { flex: 1, backgroundColor: '#080D0C' },
});
```

## `NativeScanner.tsx` (native camera + OCR, liquid-glass chrome)

```tsx
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { requireOptionalNativeModule } from 'expo';
import { GlassView } from 'expo-glass-effect';
import { Ionicons } from '@expo/vector-icons';

type TextExtractorModule = {
  isSupported: boolean;
  extractTextFromImage: (uri: string) => Promise<string[]>;
};

// Apple Vision on iOS, ML Kit on Android. Present only in a development/release
// build — Expo Go does not include it.
const TextExtractor = Platform.OS !== 'web'
  ? requireOptionalNativeModule<TextExtractorModule>('ExpoTextExtractor')
  : null;

export function NativeScanner({ onClose, onScanned }: { onClose: () => void; onScanned: (lines: string[]) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const read = async () => {
    if (reading || !cam.current) return;
    if (!TextExtractor?.isSupported) {
      setFailed('Native text recognition needs a development build (eas build --profile development).');
      return;
    }
    setReading(true);
    setFailed(null);
    try {
      const photo = await cam.current.takePictureAsync({ quality: 0.9 });
      const lines = await TextExtractor.extractTextFromImage(photo.uri.replace('file://', ''));
      const text = (Array.isArray(lines) ? lines : []).filter((l) => typeof l === 'string' && l.trim());
      if (!text.length) {
        setFailed('No text was read. Move closer, hold steady, improve the light.');
        setReading(false);
        return;
      }
      onScanned(text); // the web app parses the date and opens the save sheet
    } catch (e) {
      setFailed((e as Error)?.message || 'Could not read the label. Try again.');
      setReading(false);
    }
  };

  if (!permission) return <View style={s.fill} />;
  if (!permission.granted) {
    return (
      <View style={s.center}>
        <Text style={s.title}>Allow camera access</Text>
        <Text style={s.text}>Prexpire reads expiry dates through your camera, on this device only.</Text>
        <Pressable style={s.button} onPress={requestPermission}>
          <Text style={s.buttonText}>Allow camera</Text>
        </Pressable>
        <Pressable onPress={onClose} hitSlop={10} style={s.link}>
          <Text style={s.linkText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.fill}>
      <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} />

      {/* Liquid-glass chrome (iOS 26; plain View elsewhere) */}
      <View style={s.topBar}>
        <GlassView glassEffectStyle="regular" tintColor="#0B161A" style={s.chromeGlass}>
          <Pressable onPress={onClose} style={s.chromeBtn} accessibilityRole="button" accessibilityLabel="Close scanner">
            <Ionicons name="chevron-back" size={24} color="#F2F6F7" />
          </Pressable>
        </GlassView>
        <GlassView glassEffectStyle="regular" tintColor="#0B161A" style={s.chromeGlass}>
          <Pressable onPress={() => setTorch((t) => !t)} style={s.chromeBtn} accessibilityRole="button" accessibilityLabel="Flashlight">
            <Ionicons name={torch ? 'flash' : 'flash-outline'} size={21} color={torch ? '#2EE8B6' : '#F2F6F7'} />
          </Pressable>
        </GlassView>
      </View>

      <View pointerEvents="none" style={s.frame} />
      <Text style={s.hint}>{reading ? 'Reading the label…' : (failed ?? 'Point at the expiry date, then tap the shutter')}</Text>
      {failed !== null && !reading && (
        <Pressable onPress={() => setFailed(null)} hitSlop={10} style={s.link}>
          <Text style={s.linkText}>Try again</Text>
        </Pressable>
      )}

      <GlassView glassEffectStyle="regular" tintColor="#06352A" style={s.shutterGlass}>
        <Pressable onPress={read} disabled={reading} style={s.shutter} accessibilityRole="button" accessibilityLabel="Read expiry date">
          {reading ? <ActivityIndicator color="#2EE8B6" /> : <Ionicons name="scan-outline" size={30} color="#2EE8B6" />}
        </Pressable>
      </GlassView>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, backgroundColor: '#050D10' },
  center: { flex: 1, backgroundColor: '#050D10', alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  title: { color: '#F2F6F7', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  text: { color: '#9AA7AD', fontSize: 14.5, textAlign: 'center', lineHeight: 21, marginBottom: 10 },
  button: { height: 50, paddingHorizontal: 28, borderRadius: 999, backgroundColor: '#2EE8B6', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#04241B', fontSize: 16, fontWeight: '700' },
  link: { paddingVertical: 8, paddingHorizontal: 12 },
  linkText: { color: '#2EE8B6', fontSize: 15, fontWeight: '600' },
  topBar: { position: 'absolute', top: 14, left: 14, right: 14, flexDirection: 'row', justifyContent: 'space-between' },
  chromeGlass: { width: 46, height: 46, borderRadius: 23, overflow: 'hidden' },
  chromeBtn: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  frame: { position: 'absolute', left: 24, right: 24, top: '38%', height: 130, borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(46,232,182,0.55)' },
  hint: { position: 'absolute', top: '60%', left: 24, right: 24, color: '#F2F6F7', fontSize: 14.5, textAlign: 'center' },
  shutterGlass: { position: 'absolute', bottom: 34, left: '50%', marginLeft: -33, width: 66, height: 66, borderRadius: 33, overflow: 'hidden' },
  shutter: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center' },
});
```

## Why not just run the app itself natively?

The repo **is** a full Expo app (`App.tsx`, `src/screens/…`): `npx expo start`
runs it in Expo Go, and a development build gets the same native scanner with
the full live-scan loop (auto-detect, agreement window, hints) instead of a
shutter. The WebView shell is only worth it if you want the website to be the
single source of truth and update instantly without rebuilding the app.

## Recognition quality

| Path | Engine | Where it runs |
| --- | --- | --- |
| Web (Vercel / sandbox) | Tesseract WASM | in the browser |
| Native app / dev build | Apple Vision (iOS) · ML Kit (Android) | on device |
| This shell (dev build) | Apple Vision (iOS) · ML Kit (Android) | on device, result handed to the web UI |
