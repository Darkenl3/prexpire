# shellcheck — type-check + test harness for the Expo shell delivery files

The native-shell delivery lives outside this repo (`expo-shell/` in the
workspace; the website here is the single source of truth for the shared
logic). This folder verifies the delivered copies with this repo's installed
Expo SDK types and Node test runner:

- `src/` — **refreshed copies** of the delivery files (`index.tsx`,
  `NativeScanner.tsx`, `GlassTabBar.tsx`, `scanner/*`). Re-copy before
  running after any delivery change; they are intentionally not imported by
  the app itself.
- `stubs/` — ambient module declarations for the two packages this repo does
  not install (`expo-glass-effect`, `react-native-webview`), mirroring the
  shell project's pinned versions.
- `tests/` — the shell's date-parser suite (byte-identical port of
  `src/scanner/dateParser.test.ts`, pointed at the ported parser) and the
  product-name heuristic suite.

Run from the repo root:

```bash
npx tsc --noEmit -p shellcheck/tsconfig.json
node --test --experimental-strip-types --no-warnings shellcheck/tests/dateParser.test.ts shellcheck/tests/productGuess.test.ts
```
