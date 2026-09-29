# Spec 1 · Plan C — Mobile App (Expo) Sign-in, Contacts, Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Expo template in `apps/mobile` into the BYTESAC dark-first mobile client with Reown AppKit wallet sign-in (EVM + Solana), bearer sessions in the device keychain, skippable contact verification, and Home/Profile tabs, reusing the shared packages from Plans A and B.

**Architecture:** Expo Router (`src/app`) with `(auth)` and `(app)` groups guarded by an auth context that loads the session token from `expo-secure-store`. `@repo/api-client` runs with bearer transport (sends `X-Client: mobile`). Wallet SDK access is isolated in `useWalletConnector()`; EVM signing uses wagmi's `useSignMessage`, Solana uses the Reown provider's `solana_signMessage`. Presentational components are SDK-free so they test under `jest-expo`.

**Tech Stack:** Expo SDK 57, React Native 0.86, Expo Router, NativeWind 5 (Tailwind v4 CSS), `@reown/appkit-react-native` 2.0 (+ wagmi and Solana adapters), wagmi 2.19, viem 2, TanStack Query 5, `expo-secure-store`, `@expo-google-fonts/manrope` + `inter`, `lucide-react-native`, jest-expo + React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-29-foundation-user-auth-design.md` (§8.1–8.4, §5). **Depends on:** Plan A (API, contracts, api-client) and Plan B Task 1 + Task 4 shared code in `@repo/api-client` (`describeError`, `verifyReducer`, `normalizeOtp`, `chainFromCaip`, `isUserRejection`, `WalletRejectedError`, `ConnectedAccount`).

## Global Constraints

- **Read `apps/mobile/AGENTS.md` first.** Expo changes every SDK: before touching any Expo/RN API, read `https://docs.expo.dev/versions/v57.0.0/` for that API and `https://docs.expo.dev/llms.txt`. Install native packages with `npx expo install <pkg>` (from `apps/mobile`), never `pnpm add` for Expo-managed packages. Never hand-edit `ios/`/`android/`; configure via `app.json` and config plugins.
- Dark mode only. Colors/fonts exactly from `docs/BYTESAC_Design_System.md` §13 (NativeWind). Manrope for headings, Inter for body.
- Minimum touch target 44×44 (`min-h-11 min-w-11`). Status never by color alone. Icons: `lucide-react-native` only.
- Wallet connection and signature are separate visible steps. Explainer copy, exactly: `You're signing a message to prove you control this address. It does not authorize any transaction or spending.`
- Home empty-state copy, exactly: `You're signed in. Basket discovery arrives soon.` Tabs: **Home** and **Profile** only.
- Session token is stored **only** in `expo-secure-store` (key `bytesac.session`). AppKit connection state uses AsyncStorage; it never holds the session token.
- `wagmi` must stay `2.x` (`@reown/appkit-wagmi-react-native` peer range `>=2 <3`).
- Dev target is an **Expo development build**, not Expo Go (deep links + native modules). App scheme `bytesac`.
- Bundle identifiers default to `com.bytesac.app` (iOS `bundleIdentifier`, Android `package`) — confirm with the product owner before any store build.

## Review Focus

1. **App killed and reopened with an expired token** → boot shows sign-in with the expired banner, not a blank screen or crash loop. Test in Task 3.
2. **Wallet app returns to Bytesac without signing (user switched back manually)** → verify step stays in "Waiting for wallet…" only until the request settles; a rejection maps to "Signature cancelled" and "Try again" works. Covered by component test in Task 4 (rejection state) and manual check in Task 7.
3. **SecureStore unavailable/throws (e.g. device keychain locked)** → treat as signed out and show sign-in; never crash. Test in Task 3.
4. **Phone number typed without `+`** → server `VALIDATION_FAILED` message shown inline, value preserved. Test in Task 5.
5. **Add chain account rotates the session** → new token saved before the old one is discarded; subsequent requests use the new token. Test in Task 3 (token-store) and Task 6 (flow).

---

## File Structure

```
apps/mobile/
  app.json                              name/scheme/dark/splash/ids/iOS schemes/plugins
  babel.config.js                       unstable_transformImportMeta (Reown/valtio)
  plugins/wallet-queries.js             Android <queries> for wallet detection
  eas.json                              development profile (dev client)
  .env.example                          EXPO_PUBLIC_API_URL, EXPO_PUBLIC_REOWN_PROJECT_ID
  jest.config.js, test/setup.ts
  assets/images/logo.png                copied from docs/logo.png
  src/global.css                        Tailwind v4 + NativeWind theme with BYTESAC tokens
  src/lib/polyfills.ts                  WalletConnect compat, random values, text-encoding
  src/lib/appkit.ts                     createAppKit (wagmi + solana adapters, Phantom/Solflare)
  src/lib/appkit-storage.ts             AsyncStorage Storage for AppKit
  src/lib/token-store.ts                SecureStore wrapper (never throws)
  src/lib/api.ts                        api client (bearer) bound to token-store
  src/lib/auth-context.tsx              AuthProvider/useAuth + QueryClient with expiry handling
  src/lib/format.ts                     shortAddress, formatRelative
  src/lib/wallet/use-wallet-connector.ts
  src/lib/auth/use-wallet-verification.ts
  src/components/ui/{app-text,button,card,text-field,status-badge,screen}.tsx
  src/components/brand/logo.tsx
  src/components/auth/{welcome-card,verify-wallet-card,wallet-verification}.tsx
  src/components/contacts/{otp-field,contact-verifier}.tsx
  src/components/profile/{wallet-section,contacts-section,notifications-section,sessions-section}.tsx
  src/app/_layout.tsx                   polyfills first, fonts, providers, <AppKit />
  src/app/index.tsx                     redirect by auth status
  src/app/(auth)/_layout.tsx, sign-in.tsx, contact.tsx
  src/app/(app)/_layout.tsx             bottom tabs Home, Profile (guarded)
  src/app/(app)/home.tsx, profile.tsx
  test/*.test.tsx
Removed: src/app/explore.tsx, src/components/{animated-icon*,app-tabs*,external-link,hint-row,themed-*,web-badge,ui/collapsible}.tsx, src/constants/theme.ts, src/hooks/*, scripts/reset-project.js, template images not used
```

---

### Task 1: Mobile foundation — remove template, BYTESAC theme, fonts, logo, jest

**Files:**
- Delete: template files listed above
- Modify: `apps/mobile/app.json`, `apps/mobile/package.json`, `apps/mobile/src/global.css`
- Create: `apps/mobile/assets/images/logo.png`, `src/components/brand/logo.tsx`, `src/components/ui/app-text.tsx`, `button.tsx`, `card.tsx`, `text-field.tsx`, `status-badge.tsx`, `screen.tsx`, `src/lib/format.ts`, `jest.config.js`, `test/setup.ts`, `test/tokens.test.ts`, `test/ui.test.tsx`, temporary `src/app/_layout.tsx` + `src/app/index.tsx`

**Interfaces:**
- Produces:
  - `<AppText variant="display" | "h1" | "h2" | "h3" | "body" | "bodyLarge" | "label" | "micro" tone?="ivory" | "stone" | "mint" | "danger" className? />`
  - `<Button variant="primary" | "secondary" | "ghost" | "destructive" loading? disabled? onPress accessibilityLabel? icon?>label</Button>` (min 44 px, keeps width while loading)
  - `<Card>`, `<Screen scroll?>` (SafeArea + `bg-space`), `<TextField label value onChangeText error? helper? …TextInputProps />`, `<StatusBadge tone label />`, `<Logo size? />`
  - Tailwind classes: `bg-space`, `bg-slate`, `text-ivory`, `text-stone`, `bg-sage`, `text-mint`, `border-border-dark`, `font-display`, `font-display-semibold`, `font-sans`, `font-sans-medium`, `font-sans-semibold`
  - `shortAddress`, `formatRelative` (same behavior as web `lib/format.ts`)

- [ ] **Step 1: Read Expo docs** for `expo-font`, `expo-splash-screen`, `expo-router` layouts and `expo-system-ui` at `https://docs.expo.dev/versions/v57.0.0/`.

- [ ] **Step 2: Remove template files**

```bash
cd apps/mobile
git rm src/app/explore.tsx src/components/animated-icon.tsx src/components/animated-icon.web.tsx src/components/animated-icon.module.css \
  src/components/app-tabs.tsx src/components/app-tabs.web.tsx src/components/external-link.tsx src/components/hint-row.tsx \
  src/components/themed-text.tsx src/components/themed-view.tsx src/components/web-badge.tsx src/components/ui/collapsible.tsx \
  src/constants/theme.ts src/hooks/use-color-scheme.ts src/hooks/use-color-scheme.web.ts src/hooks/use-theme.ts scripts/reset-project.js \
  assets/images/tutorial-web.png assets/images/react-logo.png assets/images/react-logo@2x.png assets/images/react-logo@3x.png \
  assets/images/expo-badge.png assets/images/expo-badge-white.png assets/images/expo-logo.png assets/images/logo-glow.png
cp ../../docs/logo.png assets/images/logo.png
```
Remove the `reset-project` script from `package.json`.

- [ ] **Step 3: Install fonts, icons, test deps**

```bash
npx expo install expo-font @expo-google-fonts/manrope @expo-google-fonts/inter lucide-react-native react-native-svg
npx expo install jest-expo jest @testing-library/react-native @types/jest -- --save-dev
pnpm add @repo/contracts@workspace:* @repo/api-client@workspace:* @repo/design-tokens@workspace:*
```
Add scripts: `"test": "jest"`, `"check-types": "tsc --noEmit"`.

- [ ] **Step 4: `app.json`** — set:

```json
{
  "expo": {
    "name": "Bytesac",
    "slug": "bytesac",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "bytesac",
    "userInterfaceStyle": "dark",
    "backgroundColor": "#0B1117",
    "ios": { "icon": "./assets/expo.icon", "bundleIdentifier": "com.bytesac.app" },
    "android": {
      "package": "com.bytesac.app",
      "adaptiveIcon": {
        "backgroundColor": "#0B1117",
        "foregroundImage": "./assets/images/android-icon-foreground.png",
        "backgroundImage": "./assets/images/android-icon-background.png",
        "monochromeImage": "./assets/images/android-icon-monochrome.png"
      },
      "predictiveBackGestureEnabled": false
    },
    "web": { "output": "static", "favicon": "./assets/images/favicon.png" },
    "plugins": [
      "expo-router",
      "expo-font",
      ["expo-splash-screen", { "backgroundColor": "#0B1117", "image": "./assets/images/logo.png", "imageWidth": 96 }]
    ],
    "experiments": { "typedRoutes": true, "reactCompiler": true }
  }
}
```
(Keep existing icon assets until an approved app icon exists; do not redraw the logo.)

- [ ] **Step 5: `src/global.css`** (design system §13, plus per-weight font families because React Native selects weight by family name)

```css
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/preflight.css" layer(base);
@import "tailwindcss/utilities.css";
@import "nativewind/theme";

@theme {
  --color-space: #0B1117;
  --color-slate: #1F2937;
  --color-stone: #6B7280;
  --color-sage: #10B981;
  --color-mint: #6EE7B7;
  --color-sand: #EEDCC8;
  --color-ivory: #FAFAF8;
  --color-card: #111B24;
  --color-muted-foreground: #A1AAB5;
  --color-success: #22C55E;
  --color-warning: #F59E0B;
  --color-danger: #F87171;
  --color-info: #60A5FA;
  --color-border-dark: #26323D;

  --font-display: "Manrope_700Bold";
  --font-display-semibold: "Manrope_600SemiBold";
  --font-sans: "Inter_400Regular";
  --font-sans-medium: "Inter_500Medium";
  --font-sans-semibold: "Inter_600SemiBold";

  --radius-sm: 0.5rem;
  --radius-md: 0.75rem;
  --radius-lg: 1rem;
  --radius-xl: 1.25rem;
  --radius-2xl: 1.5rem;
}
```
Verify the font family names exposed by `@expo-google-fonts/*` (e.g. `Manrope_700Bold`) in their README before relying on them (design system §13 requires this check).

- [ ] **Step 6: Jest config** — `jest.config.js`:

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFiles: ["./test/setup.ts"],
  testMatch: ["<rootDir>/test/**/*.test.ts?(x)"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1", "\\.css$": "<rootDir>/test/style-mock.js" },
  transformIgnorePatterns: [
    "node_modules/(?!(?:\\.pnpm/[^/]+/node_modules/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|expo-router|react-navigation|@react-navigation/.*|@repo/.*|lucide-react-native|zod|react-native-svg|nativewind|react-native-css))",
  ],
};
```
Create `test/style-mock.js` → `module.exports = {};` and `test/setup.ts`:
```ts
jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k: string) => { store.delete(k); }),
    __store: store,
  };
});
```

- [ ] **Step 7: Failing tests**

`test/tokens.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { palette, semantic } from "@repo/design-tokens";

const css = readFileSync(join(__dirname, "../src/global.css"), "utf8");

describe("global.css matches @repo/design-tokens", () => {
  it("brand palette", () => {
    for (const [name, hex] of Object.entries(palette)) expect(css).toContain(`--color-${name}: ${hex};`);
  });
  it("semantic", () => {
    expect(css).toContain(`--color-border-dark: ${semantic.borderDark};`);
    expect(css).toContain(`--color-danger: ${semantic.danger};`);
  });
});
```

`test/ui.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { TextField } from "@/components/ui/text-field";
import { formatRelative, shortAddress } from "@/lib/format";

describe("ui primitives", () => {
  it("Button fires and is disabled while loading", () => {
    const onPress = jest.fn();
    const { rerender } = render(<Button onPress={onPress}>Sign message</Button>);
    fireEvent.press(screen.getByRole("button", { name: "Sign message" }));
    expect(onPress).toHaveBeenCalledTimes(1);
    rerender(<Button onPress={onPress} loading>Sign message</Button>);
    expect(screen.getByRole("button", { name: "Sign message" })).toBeDisabled();
  });
  it("StatusBadge shows text, not only color", () => {
    render(<StatusBadge tone="success" label="Verified" />);
    expect(screen.getByText("Verified")).toBeOnTheScreen();
  });
  it("TextField links label and error", () => {
    render(<TextField label="Email address" value="x" onChangeText={() => undefined} error="Enter a valid email address" />);
    expect(screen.getByLabelText("Email address")).toBeOnTheScreen();
    expect(screen.getByText("Enter a valid email address")).toBeOnTheScreen();
  });
  it("format helpers", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(formatRelative("2026-09-29T11:00:00Z", new Date("2026-09-29T12:00:00Z"))).toBe("1 hour ago");
  });
});
```

- [ ] **Step 8: Run — expect FAIL** — `pnpm --filter mobile test`

- [ ] **Step 9: Implement primitives**

`src/lib/format.ts` — identical code to `apps/web/lib/format.ts` (Plan B Task 3 Step 3).

`src/components/ui/app-text.tsx`:
```tsx
import { Text, type TextProps } from "react-native";

const VARIANTS = {
  display: "font-display text-4xl leading-[44px]",
  h1: "font-display text-3xl leading-[38px]",
  h2: "font-display text-[28px] leading-9",
  h3: "font-display-semibold text-[22px] leading-[30px]",
  h4: "font-display-semibold text-lg leading-[26px]",
  bodyLarge: "font-sans text-base leading-[26px]",
  body: "font-sans text-sm leading-[22px]",
  label: "font-sans-medium text-xs leading-[18px]",
  micro: "font-sans text-[11px] leading-4",
} as const;
const TONES = { ivory: "text-ivory", stone: "text-stone", muted: "text-muted-foreground", mint: "text-mint", danger: "text-danger", space: "text-space" } as const;

export function AppText({ variant = "body", tone = "ivory", className = "", ...rest }: TextProps & { variant?: keyof typeof VARIANTS; tone?: keyof typeof TONES; className?: string }) {
  return <Text {...rest} className={`${VARIANTS[variant]} ${TONES[tone]} ${className}`} />;
}
```

`src/components/ui/button.tsx`:
```tsx
import { ActivityIndicator, Pressable, View } from "react-native";
import type { ReactNode } from "react";
import { palette } from "@repo/design-tokens";
import { AppText } from "./app-text";

const STYLES = {
  primary: { box: "bg-sage", text: "space" as const },
  secondary: { box: "bg-slate border border-border-dark", text: "ivory" as const },
  ghost: { box: "bg-transparent", text: "ivory" as const },
  destructive: { box: "bg-danger", text: "space" as const },
};

export function Button({ children, onPress, variant = "primary", loading = false, disabled = false, icon, accessibilityLabel, className = "" }: {
  children: string; onPress(): void; variant?: keyof typeof STYLES; loading?: boolean; disabled?: boolean; icon?: ReactNode; accessibilityLabel?: string; className?: string;
}) {
  const s = STYLES[variant];
  const off = disabled || loading;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? children} accessibilityState={{ disabled: off, busy: loading }}
      disabled={off} onPress={onPress}
      className={`min-h-11 flex-row items-center justify-center gap-2 rounded-xl px-4 ${s.box} ${off ? "opacity-60" : ""} ${className}`}>
      {loading ? <ActivityIndicator color={s.text === "space" ? palette.space : palette.ivory} /> : icon ? <View>{icon}</View> : null}
      <AppText variant="body" tone={s.text} className="font-sans-semibold">{children}</AppText>
    </Pressable>
  );
}
```

`src/components/ui/card.tsx`, `screen.tsx`, `status-badge.tsx`, `text-field.tsx`, `brand/logo.tsx`:
```tsx
// card.tsx
import { View, type ViewProps } from "react-native";
export function Card({ className = "", ...rest }: ViewProps & { className?: string }) {
  return <View {...rest} className={`rounded-2xl border border-border-dark bg-slate p-5 ${className}`} />;
}
```
```tsx
// screen.tsx
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView className="flex-1 bg-space">
      {scroll ? <ScrollView contentContainerClassName="gap-5 px-4 py-6" keyboardShouldPersistTaps="handled">{children}</ScrollView>
        : <View className="flex-1 gap-5 px-4 py-6">{children}</View>}
    </SafeAreaView>
  );
}
```
```tsx
// status-badge.tsx
import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react-native";
import { View } from "react-native";
import { palette, semantic } from "@repo/design-tokens";
import { AppText } from "./app-text";
const TONES = {
  success: { Icon: CheckCircle2, color: semantic.success },
  warning: { Icon: AlertTriangle, color: semantic.warning },
  danger: { Icon: XCircle, color: semantic.danger },
  neutral: { Icon: CircleDashed, color: palette.stone },
} as const;
export function StatusBadge({ tone, label }: { tone: keyof typeof TONES; label: string }) {
  const { Icon, color } = TONES[tone];
  return (
    <View className="flex-row items-center gap-1 self-start rounded-lg border border-border-dark px-2 py-0.5">
      <Icon size={14} color={color} accessibilityElementsHidden importantForAccessibility="no" />
      <AppText variant="label" style={{ color }}>{label}</AppText>
    </View>
  );
}
```
```tsx
// text-field.tsx
import { useId } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { palette } from "@repo/design-tokens";
import { AppText } from "./app-text";
export function TextField({ label, error, helper, ...rest }: TextInputProps & { label: string; error?: string | null; helper?: string }) {
  const id = useId();
  return (
    <View className="gap-2">
      <AppText variant="label" nativeID={id}>{label}</AppText>
      <TextInput {...rest} accessibilityLabel={label} aria-labelledby={id} aria-invalid={Boolean(error)}
        placeholderTextColor={palette.stone}
        className={`min-h-11 rounded-xl border bg-space px-3 font-sans text-base text-ivory ${error ? "border-danger" : "border-border-dark"}`} />
      {error ? <AppText variant="label" tone="danger" accessibilityRole="alert">{error}</AppText>
        : helper ? <AppText variant="label" tone="stone">{helper}</AppText> : null}
    </View>
  );
}
```
```tsx
// brand/logo.tsx
import { Image } from "expo-image";
export function Logo({ size = 40 }: { size?: number }) {
  return <Image source={require("../../../assets/images/logo.png")} style={{ width: size, height: size }} accessibilityLabel="Bytesac" contentFit="contain" />;
}
```

- [ ] **Step 10: Temporary root layout** (replaced in Task 3) — `src/app/_layout.tsx` loads fonts and renders `<Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.space } }} />`; `src/app/index.tsx` renders a `<Screen>` with `<Logo />` and `<AppText variant="h1">Bytesac</AppText>`. Font loading:

```tsx
import "@/global.css";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { Manrope_600SemiBold, Manrope_700Bold } from "@expo-google-fonts/manrope";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { palette } from "@repo/design-tokens";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({ Manrope_600SemiBold, Manrope_700Bold, Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  useEffect(() => { if (loaded || error) void SplashScreen.hideAsync(); }, [loaded, error]);
  if (!loaded && !error) return null;
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.space } }} />
    </>
  );
}
```

- [ ] **Step 11: Run — expect PASS** — `pnpm --filter mobile test && pnpm --filter mobile check-types && cd apps/mobile && npx expo lint && npx expo-doctor`

- [ ] **Step 12: Commit**

```bash
git add apps/mobile pnpm-lock.yaml
git commit -m "feat(mobile): replace template with BYTESAC dark theme, fonts and UI primitives"
```

---

### Task 2: Reown AppKit React Native — compatibility gate and wallet layer

This is the spec §12 "first plan task" for mobile: prove Reown AppKit RN works on Expo SDK 57 / RN 0.86 before building screens on it. **If any step fails and cannot be fixed within this task, stop and report to the user with exact errors** (fallback per spec: keep `useWalletConnector` and use wallet-specific deep-link SDKs — a product decision).

**Files:**
- Create: `apps/mobile/babel.config.js`, `plugins/wallet-queries.js`, `eas.json`, `.env.example`, `src/lib/polyfills.ts`, `src/lib/appkit-storage.ts`, `src/lib/appkit.ts`, `src/lib/wallet/use-wallet-connector.ts`
- Modify: `apps/mobile/app.json` (iOS `LSApplicationQueriesSchemes`, plugin), `src/app/_layout.tsx` (providers)
- Temporary: `src/app/wallet-debug.tsx` (deleted at the end of this task)

**Interfaces:**
- Produces:
  - `appKit` instance and `wagmiAdapter`; `<WalletProviders>` = `WagmiProvider` + `AppKitProvider` (must be inside `QueryClientProvider`)
  - `useWalletConnector(): { account: ConnectedAccount | null; network: "supported" | "unsupported" | "none"; connect(): void; disconnect(): Promise<void>; switchToSupported(): Promise<void>; signMessage(message: string): Promise<string> }` — hex for EVM, base58 for Solana, throws `WalletRejectedError` on cancel.

- [ ] **Step 1: Read** Reown RN docs: installation (`https://docs.reown.com/appkit/react-native/core/installation`), hooks (`…/core/hooks`), and the Solana/Wagmi adapter pages. Confirm hook names used below: `useAppKit`, `useAccount`, `useProvider`, `useWalletInfo`.

- [ ] **Step 2: Install** (from `apps/mobile`)

```bash
npx expo install @reown/appkit-react-native @react-native-async-storage/async-storage react-native-get-random-values react-native-svg @react-native-community/netinfo @walletconnect/react-native-compat react-native-safe-area-context expo-application
npx expo install @reown/appkit-wagmi-react-native wagmi@2.19.5 viem@2.56.9 @tanstack/react-query
npx expo install @reown/appkit-solana-react-native text-encoding bs58 @walletconnect/safe-json
npx expo install expo-dev-client expo-secure-store
npx expo-doctor
```
Expected: no peer-dependency errors. If `expo install` reports version mismatches for any Reown peer, record them verbatim.

- [ ] **Step 3: `babel.config.js`**

```js
module.exports = function (api) {
  api.cache(true);
  return { presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]] };
};
```
(NativeWind 5 does not need a Babel preset; confirm in NativeWind v5 docs.)

- [ ] **Step 4: Wallet detection** — in `app.json` add `"ios": { …, "infoPlist": { "LSApplicationQueriesSchemes": ["metamask", "trust", "safe", "rainbow", "uniswap", "phantom", "solflare"] } }` and append `"./plugins/wallet-queries.js"` to `plugins`. `plugins/wallet-queries.js`:

```js
const { withAndroidManifest, createRunOncePlugin } = require("expo/config-plugins");

const queries = {
  package: [
    { $: { "android:name": "io.metamask" } },
    { $: { "android:name": "com.wallet.crypto.trustapp" } },
    { $: { "android:name": "me.rainbow" } },
    { $: { "android:name": "app.phantom" } },
    { $: { "android:name": "com.solflare.mobile" } },
  ],
};

const withWalletQueries = (config) =>
  withAndroidManifest(config, (c) => {
    c.modResults.manifest = { ...c.modResults.manifest, queries };
    return c;
  });

module.exports = createRunOncePlugin(withWalletQueries, "withWalletQueries", "1.0.0");
```

- [ ] **Step 5: `eas.json` and `.env.example`**

```json
{
  "cli": { "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal", "env": { "EXPO_PUBLIC_API_URL": "http://10.0.2.2:4000" } }
  }
}
```
```dotenv
# Android emulator reaches the host via 10.0.2.2; physical devices need the host's LAN IP or a tunnel.
EXPO_PUBLIC_API_URL=http://10.0.2.2:4000
EXPO_PUBLIC_REOWN_PROJECT_ID=
```

- [ ] **Step 6: `src/lib/polyfills.ts`** (must be the first import in `_layout.tsx`)

```ts
import "@walletconnect/react-native-compat";
import "react-native-get-random-values";
import "text-encoding";
```

- [ ] **Step 7: `src/lib/appkit-storage.ts`**

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Storage } from "@reown/appkit-react-native";
import { safeJsonParse, safeJsonStringify } from "@walletconnect/safe-json";

/** AppKit connection state only. The Bytesac session token never goes here (see token-store.ts). */
export const appKitStorage: Storage = {
  getKeys: async () => [...(await AsyncStorage.getAllKeys())],
  getEntries: async <T = unknown>(): Promise<[string, T][]> => {
    const keys = await AsyncStorage.getAllKeys();
    const entries = await AsyncStorage.multiGet(keys);
    return entries.map(([k, v]) => [k, safeJsonParse(v ?? "") as T]);
  },
  setItem: async (key, value) => { await AsyncStorage.setItem(key, safeJsonStringify(value)); },
  getItem: async <T = unknown>(key: string): Promise<T | undefined> => {
    const item = await AsyncStorage.getItem(key);
    return item === null ? undefined : (safeJsonParse(item) as T);
  },
  removeItem: async (key) => { await AsyncStorage.removeItem(key); },
};
```

- [ ] **Step 8: `src/lib/appkit.tsx`**

```tsx
import { AppKitProvider, createAppKit, solana } from "@reown/appkit-react-native";
import { PhantomConnector, SolanaAdapter, SolflareConnector } from "@reown/appkit-solana-react-native";
import { WagmiAdapter } from "@reown/appkit-wagmi-react-native";
import type { ReactNode } from "react";
import { arbitrum, base, bsc, mainnet } from "viem/chains";
import { WagmiProvider } from "wagmi";
import { appKitStorage } from "./appkit-storage";

const projectId = process.env.EXPO_PUBLIC_REOWN_PROJECT_ID ?? "";
const evm = [mainnet, base, bsc, arbitrum] as const;

export const wagmiAdapter = new WagmiAdapter({ projectId, networks: [...evm] });

export const appKit = createAppKit({
  projectId,
  adapters: [wagmiAdapter, new SolanaAdapter()],
  networks: [...evm, solana],
  defaultNetwork: mainnet,
  storage: appKitStorage,
  extraConnectors: [new PhantomConnector({ cluster: "mainnet-beta" }), new SolflareConnector({ cluster: "mainnet-beta" })],
  enableAnalytics: false,
  metadata: {
    name: "Bytesac",
    description: "Manager-led, multi-chain investment baskets.",
    url: "https://bytesac.com",
    icons: ["https://bytesac.com/logo.png"],
    redirect: { native: "bytesac://" },
  },
});

export function WalletProviders({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <AppKitProvider instance={appKit}>{children}</AppKitProvider>
    </WagmiProvider>
  );
}
```
Confirm the `metadata.url`/`icons` production domain with the product owner; it is shown in wallets.

- [ ] **Step 9: `src/lib/wallet/use-wallet-connector.ts`** — the only module importing Reown hooks/wagmi actions.

```ts
import { chainFromCaip, isUserRejection, WalletRejectedError, type ConnectedAccount } from "@repo/api-client";
import { useAccount, useAppKit, useProvider, useWalletInfo } from "@reown/appkit-react-native";
import bs58 from "bs58";
import { useCallback } from "react";
import { useSignMessage } from "wagmi";

export type { ConnectedAccount };

export function useWalletConnector() {
  const { open, disconnect, switchNetwork } = useAppKit();
  const { address, chainId, isConnected, namespace } = useAccount();
  const { provider } = useProvider();
  const { walletInfo } = useWalletInfo();
  const { signMessageAsync } = useSignMessage();

  const caip = isConnected && namespace && chainId !== undefined ? `${namespace}:${chainId}` : undefined;
  const mapped = chainFromCaip(caip);
  const network: "supported" | "unsupported" | "none" = !isConnected || mapped === null ? "none" : mapped === "unsupported" ? "unsupported" : "supported";
  const account: ConnectedAccount | null =
    isConnected && address && mapped && mapped !== "unsupported" ? { chain: mapped, address, walletName: walletInfo?.name ?? null } : null;

  const signMessage = useCallback(async (message: string): Promise<string> => {
    if (!account) throw new Error("No supported wallet account connected");
    try {
      if (account.chain === "solana") {
        if (!provider) throw new Error("Solana provider unavailable");
        const params = { message: bs58.encode(new TextEncoder().encode(message)), pubkey: account.address };
        const { signature } = (await provider.request({ method: "solana_signMessage", params }, caip)) as { signature: string };
        return signature; // base58
      }
      return await signMessageAsync({ message });
    } catch (err) {
      if (isUserRejection(err)) throw new WalletRejectedError();
      throw err;
    }
  }, [account, provider, caip, signMessageAsync]);

  return {
    account,
    network,
    connect: () => open(),
    disconnect: async () => { await disconnect(); },
    switchToSupported: async () => { await switchNetwork("eip155:1"); },
    signMessage,
  };
}
```
If `switchNetwork` expects a network object rather than a CAIP id in this version, pass the `mainnet` network object instead (check the hooks doc from Step 1).

- [ ] **Step 10: Wire providers into `_layout.tsx`** — first line `import "@/lib/polyfills";`, then wrap the `Stack` in `<SafeAreaProvider><QueryClientProvider client={queryClient}><WalletProviders>…<AppKit /></WalletProviders></QueryClientProvider></SafeAreaProvider>` (`AppKit` component from `@reown/appkit-react-native`; `queryClient = new QueryClient()` for now — Task 3 replaces it).

- [ ] **Step 11: Temporary debug screen `src/app/wallet-debug.tsx`**

```tsx
import { useState } from "react";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";

export default function WalletDebug() {
  const w = useWalletConnector();
  const [out, setOut] = useState("");
  return (
    <Screen>
      <AppText>network: {w.network}</AppText>
      <AppText selectable>account: {JSON.stringify(w.account)}</AppText>
      <Button onPress={w.connect}>Connect</Button>
      <Button onPress={async () => { try { setOut(await w.signMessage("bytesac compatibility check")); } catch (e) { setOut(String(e)); } }}>Sign</Button>
      <Button variant="ghost" onPress={() => void w.disconnect()}>Disconnect</Button>
      <AppText selectable>{out}</AppText>
    </Screen>
  );
}
```

- [ ] **Step 12: Build and run a development build** — either `npx expo run:android` (requires Android SDK + emulator; set `ANDROID_HOME`) or `npx eas-cli@latest build --profile development --platform android` (requires an Expo account; install the APK on a device). iOS requires macOS or EAS. Then `npx expo start --dev-client`, open `bytesac://wallet-debug`.

- [ ] **Step 13: Compatibility checklist (record results verbatim in the task report)**
  1. App boots with no red screen; `npx expo-doctor` clean.
  2. Connect MetaMask (EVM) → `network: supported`, `account.chain` = connected chain.
  3. Sign → a `0x…` 65-byte signature appears. Verify it with the API: create a challenge via `curl -X POST $API/v1/auth/challenge -H 'X-Client: mobile' -H 'content-type: application/json' -d '{"purpose":"sign_in","chain":"ethereum","address":"<addr>"}'`, sign that exact message in the debug screen (temporarily paste it), then `POST /v1/auth/verify` with `client: "mobile"` → 200 with `token`.
  4. Disconnect; connect Phantom (Solana) → `account.chain = "solana"`; sign → base58 signature; repeat the API check with `chain: "solana"` → 200.
  5. Reject a signature in each wallet → the debug output shows `WalletRejectedError`.
  6. Switch MetaMask to Polygon → `network: unsupported`.
  If any item fails: stop, report, and ask the user whether to pursue the fallback.

- [ ] **Step 14: Remove the debug screen and commit**

```bash
git rm src/app/wallet-debug.tsx
git add apps/mobile pnpm-lock.yaml
git commit -m "feat(mobile): integrate Reown AppKit (EVM + Solana) behind useWalletConnector"
```

---

### Task 3: Session token store, API client, auth context, routing guards

**Files:**
- Create: `apps/mobile/src/lib/token-store.ts`, `src/lib/api.ts`, `src/lib/auth-context.tsx`, `src/app/index.tsx`, `src/app/(auth)/_layout.tsx`, `src/app/(app)/_layout.tsx`, `src/app/(app)/home.tsx`
- Modify: `src/app/_layout.tsx`
- Test: `apps/mobile/test/token-store.test.ts`, `apps/mobile/test/auth-context.test.tsx`

**Interfaces:**
- Produces:
  - `tokenStore: { get(): Promise<string | null>; set(token: string): Promise<void>; clear(): Promise<void> }` — never throws (errors → `null`/no-op + `console.warn`), key `bytesac.session`, in-memory cache.
  - `api = createApiClient({ baseUrl: process.env.EXPO_PUBLIC_API_URL, transport: { kind: "bearer", getToken: tokenStore.get } })`
  - `AuthProvider`, `useAuth(): { status: "loading" | "signedOut" | "signedIn"; expired: boolean; acceptToken(token?: string): Promise<void>; signOut(opts?: { expired?: boolean; remote?: boolean }): Promise<void> }` — `acceptToken(undefined)` keeps the current token (idempotent add-chain).
  - `createAppQueryClient(onExpired)` (same semantics as web).

- [ ] **Step 1: Failing tests**

`test/token-store.test.ts`:
```ts
import * as SecureStore from "expo-secure-store";
import { tokenStore, __resetTokenCache } from "@/lib/token-store";

beforeEach(() => { __resetTokenCache(); (SecureStore as unknown as { __store: Map<string, string> }).__store.clear(); jest.clearAllMocks(); });

describe("tokenStore", () => {
  it("round-trips via SecureStore key bytesac.session", async () => {
    await tokenStore.set("abc");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("bytesac.session", "abc");
    __resetTokenCache();
    expect(await tokenStore.get()).toBe("abc");
    await tokenStore.clear();
    expect(await tokenStore.get()).toBeNull();
  });
  it("rotation replaces the token (new value visible immediately)", async () => {
    await tokenStore.set("old");
    await tokenStore.set("new");
    expect(await tokenStore.get()).toBe("new");
  });
  it("never throws when the keychain is unavailable", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error("keychain locked"));
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await tokenStore.get()).toBeNull();
  });
});
```

`test/auth-context.test.tsx`:
```tsx
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { tokenStore, __resetTokenCache } from "@/lib/token-store";

function Probe() {
  const a = useAuth();
  return <Text testID="s">{`${a.status}:${a.expired}`}</Text>;
}

beforeEach(async () => { __resetTokenCache(); await tokenStore.clear(); });

describe("AuthProvider", () => {
  it("boots signedOut without a token and signedIn with one", async () => {
    const r = render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("signedOut:false"));
    r.unmount();
    await tokenStore.set("t");
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("signedIn:false"));
  });
  it("signOut({ expired }) clears the token and flags expiry", async () => {
    await tokenStore.set("t");
    let ctx: ReturnType<typeof useAuth> | null = null;
    function Grab() { ctx = useAuth(); return null; }
    render(<AuthProvider><Grab /><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("signedIn:false"));
    await act(async () => { await ctx!.signOut({ expired: true }); });
    expect(screen.getByTestId("s")).toHaveTextContent("signedOut:true");
    expect(await tokenStore.get()).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: `src/lib/token-store.ts`**

```ts
import * as SecureStore from "expo-secure-store";

const KEY = "bytesac.session";
let cache: string | null | undefined;

export function __resetTokenCache(): void { cache = undefined; }

export const tokenStore = {
  async get(): Promise<string | null> {
    if (cache !== undefined) return cache;
    try {
      cache = await SecureStore.getItemAsync(KEY);
    } catch (err) {
      console.warn("Secure storage unavailable; treating as signed out", err instanceof Error ? err.message : "unknown");
      cache = null;
    }
    return cache;
  },
  async set(token: string): Promise<void> {
    cache = token;
    try { await SecureStore.setItemAsync(KEY, token); } catch (err) {
      console.warn("Could not persist session token", err instanceof Error ? err.message : "unknown");
    }
  },
  async clear(): Promise<void> {
    cache = null;
    try { await SecureStore.deleteItemAsync(KEY); } catch { /* already gone */ }
  },
};
```

- [ ] **Step 4: `src/lib/api.ts`**

```ts
import { createApiClient } from "@repo/api-client";
import { tokenStore } from "./token-store";

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:4000";
export const api = createApiClient({ baseUrl, transport: { kind: "bearer", getToken: () => tokenStore.get() } });
```

- [ ] **Step 5: `src/lib/auth-context.tsx`**

```tsx
import { ApiError } from "@repo/api-client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { tokenStore } from "./token-store";

type Status = "loading" | "signedOut" | "signedIn";
interface AuthValue {
  status: Status;
  expired: boolean;
  acceptToken(token?: string): Promise<void>;
  signOut(opts?: { expired?: boolean; remote?: boolean }): Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);
const EXPIRED = new Set(["SESSION_EXPIRED", "USER_NOT_ACTIVE"]);

export function createAppQueryClient(onExpired: () => void): QueryClient {
  const handle = (e: unknown) => { if (e instanceof ApiError && EXPIRED.has(e.code)) onExpired(); };
  return new QueryClient({
    queryCache: new QueryCache({ onError: handle }),
    mutationCache: new MutationCache({ onError: handle }),
    defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, staleTime: 30_000 } },
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [expired, setExpired] = useState(false);
  const signingOut = useRef(false);

  useEffect(() => { void tokenStore.get().then((t) => setStatus(t ? "signedIn" : "signedOut")); }, []);

  const signOut = useCallback(async (opts: { expired?: boolean; remote?: boolean } = {}) => {
    if (signingOut.current) return;
    signingOut.current = true;
    try {
      if (opts.remote) await api.logout().catch(() => undefined);
      await tokenStore.clear();
      setExpired(Boolean(opts.expired));
      setStatus("signedOut");
    } finally { signingOut.current = false; }
  }, []);

  const acceptToken = useCallback(async (token?: string) => {
    if (token) await tokenStore.set(token);
    setExpired(false);
    setStatus("signedIn");
  }, []);

  const [qc] = useState(() => createAppQueryClient(() => void signOut({ expired: true })));
  useEffect(() => { if (status === "signedOut") qc.clear(); }, [status, qc]);

  const value = useMemo(() => ({ status, expired, acceptToken, signOut }), [status, expired, acceptToken, signOut]);
  return <Ctx.Provider value={value}><QueryClientProvider client={qc}>{children}</QueryClientProvider></Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
```
Note: `AuthProvider` now owns the `QueryClientProvider`; in `_layout.tsx` replace the Task 2 `QueryClientProvider` with `AuthProvider` (still outside `WalletProviders`, since wagmi needs the query client).

- [ ] **Step 6: Routing** — read the expo-router v57 docs for groups, `Redirect`, and `Tabs` first.

```tsx
// src/app/index.tsx
import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth-context";
export default function Index() {
  const { status } = useAuth();
  if (status === "loading") return null;
  return <Redirect href={status === "signedIn" ? "/(app)/home" : "/(auth)/sign-in"} />;
}
```
```tsx
// src/app/(auth)/_layout.tsx
import { Stack } from "expo-router";
import { palette } from "@repo/design-tokens";
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.space } }} />;
}
```
```tsx
// src/app/(app)/_layout.tsx
import { Redirect, Tabs } from "expo-router";
import { Home, User } from "lucide-react-native";
import { palette, semantic } from "@repo/design-tokens";
import { useAuth } from "@/lib/auth-context";

export default function AppLayout() {
  const { status } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut") return <Redirect href="/(auth)/sign-in" />;
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: { backgroundColor: palette.slate, borderTopColor: semantic.borderDark, minHeight: 56 },
      tabBarActiveTintColor: palette.mint,
      tabBarInactiveTintColor: palette.stone,
      sceneStyle: { backgroundColor: palette.space },
    }}>
      <Tabs.Screen name="home" options={{ title: "Home", tabBarIcon: ({ color, size }) => <Home color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }} />
    </Tabs>
  );
}
```
```tsx
// src/app/(app)/home.tsx
import { Compass } from "lucide-react-native";
import { palette } from "@repo/design-tokens";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";

export default function HomeScreen() {
  return (
    <Screen>
      <AppText variant="h1" accessibilityRole="header">Home</AppText>
      <Card className="items-center gap-3 py-12">
        <Compass color={palette.mint} size={40} />
        <AppText variant="bodyLarge" className="text-center">You're signed in. Basket discovery arrives soon.</AppText>
      </Card>
    </Screen>
  );
}
```
Create a placeholder `src/app/(app)/profile.tsx` (`<Screen><AppText variant="h1">Profile</AppText></Screen>`) and `src/app/(auth)/sign-in.tsx` (`<Screen><AppText variant="h1">Sign in</AppText></Screen>`); both are replaced in Tasks 4 and 6.

- [ ] **Step 7: Run — expect PASS**; **Step 8: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): add secure token store, auth context and guarded routes"
```

---

### Task 4: Sign-in and verify-wallet screens (reusable for add-chain-account)

**Files:**
- Create: `apps/mobile/src/lib/auth/use-wallet-verification.ts`, `src/components/auth/welcome-card.tsx`, `src/components/auth/verify-wallet-card.tsx`, `src/components/auth/wallet-verification.tsx`
- Replace: `src/app/(auth)/sign-in.tsx`
- Test: `apps/mobile/test/verify-wallet-card.test.tsx`

**Interfaces:**
- Consumes: `verifyReducer`, `VerifyState`, `describeError`, `WalletRejectedError`, `ConnectedAccount` from `@repo/api-client`; `useWalletConnector`; `useAuth`; `api`.
- Produces:
  - `useWalletVerification(purpose): { state; run(account): Promise<void>; reset(): void }` — sends `client: "mobile"`; on success calls `acceptToken(out.token)` **before** dispatching `VERIFIED` (rotation-safe).
  - `<VerifyWalletCard …/>` (same props as web), `<WalletVerification purpose onVerified />`.

- [ ] **Step 1: Failing test `test/verify-wallet-card.test.tsx`**

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import { VerifyWalletCard } from "@/components/auth/verify-wallet-card";

const account = { chain: "solana" as const, address: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", walletName: "Phantom" };
const h = { onSign: jest.fn(), onRetry: jest.fn(), onRestart: jest.fn(), onDisconnect: jest.fn(), onSwitchNetwork: jest.fn() };

describe("VerifyWalletCard (mobile)", () => {
  it("shows both steps, explainer, wallet, chain and short address", () => {
    render(<VerifyWalletCard account={account} network="supported" state={{ step: "idle" }} {...h} />);
    expect(screen.getByText("Connected")).toBeOnTheScreen();
    expect(screen.getByText("Sign to verify")).toBeOnTheScreen();
    expect(screen.getByText("You're signing a message to prove you control this address. It does not authorize any transaction or spending.")).toBeOnTheScreen();
    expect(screen.getByText("Phantom")).toBeOnTheScreen();
    expect(screen.getByText("Solana")).toBeOnTheScreen();
    expect(screen.getByText("4Nd1mB…DB4T")).toBeOnTheScreen();
  });
  it("busy states disable the sign button", () => {
    render(<VerifyWalletCard account={account} network="supported" state={{ step: "signing" }} {...h} />);
    expect(screen.getByRole("button", { name: "Waiting for wallet…" })).toBeDisabled();
  });
  it("rejection → Try again; expiry → Start again", () => {
    const { rerender } = render(<VerifyWalletCard account={account} network="supported" state={{ step: "error", code: "WALLET_REJECTED" }} {...h} />);
    expect(screen.getByText("Signature cancelled")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(h.onRetry).toHaveBeenCalled();
    rerender(<VerifyWalletCard account={account} network="supported" state={{ step: "error", code: "CHALLENGE_EXPIRED" }} {...h} />);
    fireEvent.press(screen.getByRole("button", { name: "Start again" }));
    expect(h.onRestart).toHaveBeenCalled();
  });
  it("unsupported network offers switch and no sign button", () => {
    render(<VerifyWalletCard account={null} network="unsupported" state={{ step: "idle" }} {...h} />);
    expect(screen.queryByRole("button", { name: "Sign message" })).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Switch network" }));
    expect(h.onSwitchNetwork).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: `use-wallet-verification.ts`**

```ts
import { ApiError, verifyReducer, WalletRejectedError, type ConnectedAccount } from "@repo/api-client";
import type { ChallengePurpose } from "@repo/contracts";
import { useCallback, useReducer, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";

export function useWalletVerification(purpose: ChallengePurpose) {
  const [state, dispatch] = useReducer(verifyReducer, { step: "idle" });
  const { signMessage } = useWalletConnector();
  const { acceptToken } = useAuth();
  const busy = useRef(false);

  const run = useCallback(async (account: ConnectedAccount) => {
    if (busy.current) return;
    busy.current = true;
    dispatch({ type: "START" });
    try {
      const ch = await api.createChallenge({ purpose, chain: account.chain, address: account.address });
      const signature = await signMessage(ch.message);
      dispatch({ type: "SIGNED" });
      const out = await api.verify({ challengeId: ch.challengeId, signature, client: "mobile", walletProvider: account.walletName ?? undefined });
      await acceptToken(out.token); // persist rotated/new token before anything else uses the API
      dispatch({ type: "VERIFIED", isNewUser: out.isNewUser });
    } catch (err) {
      if (err instanceof WalletRejectedError) dispatch({ type: "FAILED", code: "WALLET_REJECTED" });
      else if (err instanceof ApiError) dispatch({ type: "FAILED", code: err.code, retryAfterSec: err.retryAfterSec });
      else dispatch({ type: "FAILED", code: "INTERNAL" });
    } finally {
      busy.current = false;
    }
  }, [purpose, signMessage, acceptToken]);

  return { state, run, reset: () => dispatch({ type: "RESET" }) };
}
```

- [ ] **Step 4: `verify-wallet-card.tsx`** (SDK-free)

```tsx
import { describeError, type ConnectedAccount, type VerifyState } from "@repo/api-client";
import { CHAINS } from "@repo/contracts";
import { palette } from "@repo/design-tokens";
import * as Clipboard from "expo-clipboard";
import { Check, Copy, PenLine, ShieldCheck } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { shortAddress } from "@/lib/format";

interface Props {
  account: ConnectedAccount | null;
  network: "supported" | "unsupported" | "none";
  state: VerifyState;
  onSign(): void; onRetry(): void; onRestart(): void; onDisconnect(): void; onSwitchNetwork(): void;
}

function Step({ n, done, label }: { n: number; done: boolean; label: string }) {
  return (
    <View className="flex-row items-center gap-2" accessibilityLabel={`${label}${done ? ", complete" : ""}`}>
      <View className={`h-6 w-6 items-center justify-center rounded-full border ${done ? "border-sage bg-sage" : "border-border-dark"}`}>
        {done ? <Check size={14} color={palette.space} /> : <AppText variant="label" tone="stone">{String(n)}</AppText>}
      </View>
      <AppText variant="body" tone={done ? "ivory" : "stone"}>{label}</AppText>
    </View>
  );
}

export function VerifyWalletCard(p: Props) {
  const busy = p.state.step === "signing" || p.state.step === "verifying";
  const err = p.state.step === "error" ? describeError(p.state.code) : null;
  return (
    <Card className="gap-5">
      <View className="flex-row gap-4">
        <Step n={1} done={p.network !== "none"} label="Connected" />
        <Step n={2} done={p.state.step === "done"} label="Sign to verify" />
      </View>
      <AppText variant="h3" accessibilityRole="header">Verify your wallet</AppText>

      {p.network === "unsupported" ? (
        <View accessibilityRole="alert" className="gap-3 rounded-xl border border-warning p-4">
          <AppText>Your wallet is on a network Bytesac doesn't support yet. Switch to a supported network: Ethereum, Base, BNB Chain, Arbitrum or Solana.</AppText>
          <Button onPress={p.onSwitchNetwork}>Switch network</Button>
        </View>
      ) : p.account ? (
        <>
          <View className="gap-2">
            <Row label="Wallet" value={p.account.walletName ?? "Wallet"} />
            <Row label="Network" value={CHAINS[p.account.chain].label} />
            <View className="flex-row items-center justify-between">
              <AppText tone="stone">Address</AppText>
              <View className="flex-row items-center gap-1">
                <AppText className="font-sans-medium">{shortAddress(p.account.address)}</AppText>
                <Pressable accessibilityRole="button" accessibilityLabel="Copy address" className="min-h-11 min-w-11 items-center justify-center"
                  onPress={() => void Clipboard.setStringAsync(p.account!.address)}>
                  <Copy size={16} color={palette.stone} />
                </Pressable>
              </View>
            </View>
          </View>
          <View className="flex-row gap-3 rounded-xl border border-border-dark bg-space p-4">
            <ShieldCheck size={20} color={palette.mint} />
            <AppText className="flex-1">You're signing a message to prove you control this address. It does not authorize any transaction or spending.</AppText>
          </View>
          {err && (
            <View accessibilityRole="alert" className="gap-1 rounded-xl border border-danger p-4">
              <AppText className="font-sans-semibold">{err.title}</AppText>
              <AppText tone="muted">{err.message}{p.state.step === "error" && p.state.retryAfterSec ? ` Try again in ${p.state.retryAfterSec} s.` : ""}</AppText>
            </View>
          )}
          {err?.recovery === "restart" ? <Button onPress={p.onRestart}>Start again</Button>
            : err && (err.recovery === "retry" || err.recovery === "wait") ? <Button onPress={p.onRetry}>Try again</Button>
            : <Button onPress={p.onSign} loading={busy} disabled={p.state.step === "done"} icon={busy ? undefined : <PenLine size={16} color={palette.space} />}>
                {p.state.step === "signing" ? "Waiting for wallet…" : p.state.step === "verifying" ? "Verifying…" : "Sign message"}
              </Button>}
        </>
      ) : null}
      <Button variant="ghost" onPress={p.onDisconnect}>Disconnect</Button>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <AppText tone="stone">{label}</AppText>
      <AppText className="font-sans-medium">{value}</AppText>
    </View>
  );
}
```
Install `expo-clipboard` with `npx expo install expo-clipboard`, and mock it in `test/setup.ts`: `jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));`

- [ ] **Step 5: `welcome-card.tsx`, `wallet-verification.tsx`, `(auth)/sign-in.tsx`**

```tsx
// welcome-card.tsx
import { Wallet } from "lucide-react-native";
import { View } from "react-native";
import { palette } from "@repo/design-tokens";
import { Logo } from "@/components/brand/logo";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";

export function WelcomeCard({ expired, onConnect }: { expired: boolean; onConnect(): void }) {
  return (
    <View className="flex-1 justify-center gap-6">
      <View className="items-center"><Logo size={64} /></View>
      {expired && (
        <View accessibilityRole="alert" className="rounded-xl border border-info bg-slate p-3">
          <AppText>Your session expired. Sign in with your wallet again.</AppText>
        </View>
      )}
      <AppText variant="display" className="text-center" accessibilityRole="header">Welcome to Bytesac</AppText>
      <AppText variant="bodyLarge" tone="muted" className="text-center">Build, discover and invest in on-chain investment baskets.</AppText>
      <Button onPress={onConnect} icon={<Wallet size={18} color={palette.space} />}>Connect wallet</Button>
    </View>
  );
}
```
```tsx
// wallet-verification.tsx
import type { ChallengePurpose } from "@repo/contracts";
import { useEffect } from "react";
import { useWalletVerification } from "@/lib/auth/use-wallet-verification";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";
import { VerifyWalletCard } from "./verify-wallet-card";

export function WalletVerification({ purpose, onVerified }: { purpose: ChallengePurpose; onVerified(isNewUser: boolean): void }) {
  const wallet = useWalletConnector();
  const { state, run, reset } = useWalletVerification(purpose);
  useEffect(() => { if (state.step === "done") onVerified(state.isNewUser); }, [state, onVerified]);
  return (
    <VerifyWalletCard account={wallet.account} network={wallet.network} state={state}
      onSign={() => wallet.account && void run(wallet.account)}
      onRetry={() => wallet.account && void run(wallet.account)}
      onRestart={() => { reset(); if (wallet.account) void run(wallet.account); }}
      onDisconnect={() => { reset(); void wallet.disconnect(); }}
      onSwitchNetwork={() => void wallet.switchToSupported()} />
  );
}
```
```tsx
// (auth)/sign-in.tsx
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { WalletVerification } from "@/components/auth/wallet-verification";
import { WelcomeCard } from "@/components/auth/welcome-card";
import { Screen } from "@/components/ui/screen";
import { useAuth } from "@/lib/auth-context";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";

export default function SignInScreen() {
  const router = useRouter();
  const { expired } = useAuth();
  const wallet = useWalletConnector();
  const onVerified = useCallback((isNewUser: boolean) => {
    router.replace(isNewUser ? "/(auth)/contact" : "/(app)/home");
  }, [router]);
  return (
    <Screen scroll={wallet.network !== "none"}>
      {wallet.network === "none"
        ? <WelcomeCard expired={expired} onConnect={wallet.connect} />
        : <WalletVerification purpose="sign_in" onVerified={onVerified} />}
    </Screen>
  );
}
```
Because `(app)/_layout.tsx` redirects signed-out users and `acceptToken` sets `signedIn` before `VERIFIED`, `router.replace` lands on an allowed route.

- [ ] **Step 6: Run — expect PASS**; **Step 7: Commit**

```bash
git add apps/mobile pnpm-lock.yaml
git commit -m "feat(mobile): add wallet sign-in and verification screens"
```

---

### Task 5: Contact verification screen (screen 3)

**Files:**
- Create: `apps/mobile/src/components/contacts/otp-field.tsx`, `src/components/contacts/contact-verifier.tsx`, `src/app/(auth)/contact.tsx`
- Test: `apps/mobile/test/contact-verifier.test.tsx`

**Interfaces:**
- Produces: `<OtpField value onChange />` (uses `normalizeOtp`, `textContentType="oneTimeCode"`, `autoComplete="sms-otp"`); `<ContactVerifier type existing? onVerified? client? />` — same behavior as web (Plan B Task 6), including a `Change` action when verified.

- [ ] **Step 1: Failing test** (mirrors web)

```tsx
import { ApiError } from "@repo/api-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ContactVerifier } from "@/components/contacts/contact-verifier";

const contact = { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", type: "phone" as const, value: "+14155552671", status: "unverified" as const, verifiedAt: null };
const later = new Date(Date.now() + 60_000).toISOString();
const client = () => ({
  addContact: jest.fn(async () => ({ contact, verification: { expiresAt: later, resendAvailableAt: later } })),
  verifyContact: jest.fn(async () => ({ ...contact, status: "verified" as const, verifiedAt: new Date().toISOString() })),
  resendContact: jest.fn(async () => ({ contact, verification: { expiresAt: later, resendAvailableAt: later } })),
});

describe("ContactVerifier (mobile)", () => {
  it("phone: send → OTP with spaces → verified", async () => {
    const c = client();
    render(<ContactVerifier type="phone" client={c} />);
    fireEvent.changeText(screen.getByLabelText("Phone number"), "+1 415 555 2671");
    fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(c.addContact).toHaveBeenCalledWith({ type: "phone", value: "+1 415 555 2671" }));
    fireEvent.changeText(await screen.findByLabelText("6-digit code"), "123 456");
    fireEvent.press(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(c.verifyContact).toHaveBeenCalledWith(contact.id, { code: "123456" }));
    expect(await screen.findByText("Verified")).toBeOnTheScreen();
  });
  it("missing country code: server message inline, value kept", async () => {
    const c = client();
    c.addContact.mockRejectedValueOnce(new ApiError("VALIDATION_FAILED", 400, "Enter the phone number with its country code, e.g. +91 98765 43210"));
    render(<ContactVerifier type="phone" client={c} />);
    fireEvent.changeText(screen.getByLabelText("Phone number"), "98765");
    fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText(/country code/)).toBeOnTheScreen();
    expect(screen.getByLabelText("Phone number").props.value).toBe("98765");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```tsx
// otp-field.tsx
import { normalizeOtp } from "@repo/api-client";
import { TextField } from "@/components/ui/text-field";
export function OtpField({ value, onChange }: { value: string; onChange(v: string): void }) {
  return <TextField label="6-digit code" value={value} onChangeText={(t) => onChange(normalizeOtp(t))}
    keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={9} />;
}
```

```tsx
// contact-verifier.tsx
import { ApiError, describeError, type ApiClient } from "@repo/api-client";
import type { ContactType, ContactView } from "@repo/contracts";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { TextField } from "@/components/ui/text-field";
import { api } from "@/lib/api";
import { OtpField } from "./otp-field";

type Client = Pick<ApiClient, "addContact" | "verifyContact" | "resendContact">;
const LABEL: Record<ContactType, string> = { email: "Email address", phone: "Phone number" };

function useCountdown(untilIso: string | null): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!untilIso) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((new Date(untilIso).getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [untilIso]);
  return left;
}

export function ContactVerifier({ type, existing, onVerified, client = api }: { type: ContactType; existing?: ContactView; onVerified?(c: ContactView): void; client?: Client }) {
  const [value, setValue] = useState(existing?.value ?? "");
  const [contact, setContact] = useState<ContactView | null>(existing ?? null);
  const [code, setCode] = useState("");
  const [resendAt, setResendAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const left = useCountdown(resendAt);
  const verified = contact?.status === "verified";
  const awaitingCode = contact !== null && !verified && resendAt !== null;

  async function guard(fn: () => Promise<void>) {
    setPending(true); setError(null);
    try { await fn(); } catch (e) {
      setError(e instanceof ApiError ? (e.code === "VALIDATION_FAILED" ? e.message : describeError(e.code).title) : describeError("INTERNAL").title);
    } finally { setPending(false); }
  }

  return (
    <View className="gap-3">
      {contact && <StatusBadge tone={verified ? "success" : "warning"} label={verified ? "Verified" : "Unverified"} />}
      <TextField label={LABEL[type]} value={value} onChangeText={setValue} editable={!awaitingCode && !pending && !verified}
        keyboardType={type === "email" ? "email-address" : "phone-pad"} autoCapitalize="none"
        autoComplete={type === "email" ? "email" : "tel"} placeholder={type === "email" ? "you@example.com" : "+91 98765 43210"} error={error} />
      {awaitingCode ? (
        <>
          <OtpField value={code} onChange={setCode} />
          <Button onPress={() => void guard(async () => { const out = await client.verifyContact(contact!.id, { code }); setContact(out); setResendAt(null); onVerified?.(out); })}
            disabled={code.length !== 6} loading={pending}>Verify</Button>
          <Button variant="secondary" disabled={left > 0 || pending}
            onPress={() => void guard(async () => { const out = await client.resendContact(contact!.id); setResendAt(out.verification.resendAvailableAt); })}>
            {left > 0 ? `Resend in ${left} s` : "Resend code"}
          </Button>
        </>
      ) : verified ? (
        <Button variant="ghost" onPress={() => { setContact(null); setValue(""); }}>Change</Button>
      ) : (
        <Button disabled={value.trim().length < 3} loading={pending}
          onPress={() => void guard(async () => { const out = await client.addContact({ type, value }); setContact(out.contact); setResendAt(out.verification.resendAvailableAt); setCode(""); })}>
          Send code
        </Button>
      )}
      {!contact && <AppText variant="label" tone="stone">Required later before investing.</AppText>}
    </View>
  );
}
```

```tsx
// (auth)/contact.tsx
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { ContactVerifier } from "@/components/contacts/contact-verifier";
import { api } from "@/lib/api";

export default function ContactScreen() {
  const router = useRouter();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  return (
    <Screen>
      <AppText variant="h1" accessibilityRole="header">Add your contact details</AppText>
      <AppText tone="muted">We use these for important account and investment notices. Required later before investing.</AppText>
      <Card className="gap-6">
        <ContactVerifier type="email" existing={me?.contacts.find((c) => c.type === "email")} />
        <ContactVerifier type="phone" existing={me?.contacts.find((c) => c.type === "phone")} />
      </Card>
      <Button variant="ghost" onPress={() => router.replace("/(app)/home")}>Skip for now</Button>
    </Screen>
  );
}
```

- [ ] **Step 4: Run — expect PASS**; **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): add skippable email and phone verification"
```

---

### Task 6: Profile tab (screen 5)

**Files:**
- Create: `apps/mobile/src/components/profile/wallet-section.tsx`, `contacts-section.tsx`, `notifications-section.tsx`, `sessions-section.tsx`
- Replace: `src/app/(app)/profile.tsx`
- Test: `apps/mobile/test/wallet-section.test.tsx`

**Interfaces:**
- Produces: sections mirroring web behavior; `canAddChainAccount(me)` — **reuse**: move web's `canAddChainAccount` into `@repo/api-client/src/wallet.ts` as part of this task (export it; update `apps/web/components/profile/wallet-section.tsx` to import it) so both clients share one rule.

- [ ] **Step 1: Move `canAddChainAccount`** — cut the function from `apps/web/components/profile/wallet-section.tsx` into `packages/api-client/src/wallet.ts` (add `import type { MeResponse } from "@repo/contracts";`), export it, import it in web, add this test to `packages/api-client/src/wallet.test.ts`:

```ts
import { canAddChainAccount } from "./wallet.js";
const addr = (chain: string, family: "evm" | "solana", method: string) => ({ chain, chainFamily: family, address: "x", status: "active", verificationMethod: method, verifiedAt: "2026-09-29T00:00:00.000Z" });
it("canAddChainAccount", () => {
  const me = (a: unknown[]) => ({ user: {}, wallet: { addresses: a }, contacts: [] }) as never;
  expect(canAddChainAccount(me([addr("base", "evm", "eoa_ecdsa"), addr("solana", "solana", "ed25519")]))).toBe(false);
  expect(canAddChainAccount(me([addr("base", "evm", "erc1271"), addr("solana", "solana", "ed25519")]))).toBe(true);
  expect(canAddChainAccount(me([addr("solana", "solana", "ed25519")]))).toBe(true);
});
```
Run `pnpm --filter @repo/api-client test && pnpm --filter @repo/api-client build && pnpm --filter web test`.

- [ ] **Step 2: Failing mobile test `test/wallet-section.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react-native";
jest.mock("@/components/auth/wallet-verification", () => ({ WalletVerification: () => null }));
import { WalletSection } from "@/components/profile/wallet-section";

const me = {
  user: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", status: "active" as const, createdAt: "2026-09-29T00:00:00.000Z" },
  wallet: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e50", walletProvider: "Phantom", addresses: [
    { chain: "solana" as const, chainFamily: "solana" as const, address: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", status: "active" as const, verificationMethod: "ed25519" as const, verifiedAt: "2026-09-29T00:00:00.000Z" },
  ] },
  contacts: [],
};

describe("WalletSection (mobile)", () => {
  it("lists addresses with text status and offers Add chain account; no unlink", () => {
    render(<QueryClientProvider client={new QueryClient()}><WalletSection me={me} /></QueryClientProvider>);
    expect(screen.getByText("Solana")).toBeOnTheScreen();
    expect(screen.getByText("Active")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Add chain account" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /remove|unlink/i })).toBeNull();
    expect(screen.getByText("Lost access to a wallet? Contact support.")).toBeOnTheScreen();
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Implement sections** (RN `Modal` with `presentationStyle="pageSheet"` for Add chain account; RN `Switch` with `trackColor={{ true: palette.sage, false: palette.slate }}` and `accessibilityLabel` for preferences; `Alert.alert` confirmation for "Log out all devices")

```tsx
// wallet-section.tsx
import { canAddChainAccount } from "@repo/api-client";
import { CHAINS, type MeResponse } from "@repo/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Modal, View } from "react-native";
import { WalletVerification } from "@/components/auth/wallet-verification";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { StatusBadge } from "@/components/ui/status-badge";
import { shortAddress } from "@/lib/format";

const METHOD = { eoa_ecdsa: "Key signature", erc1271: "Smart wallet", erc6492: "Smart wallet (not yet deployed)", ed25519: "Key signature" } as const;

export function WalletSection({ me }: { me: MeResponse }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const onVerified = useCallback(() => { setOpen(false); void qc.invalidateQueries({ queryKey: ["me"] }); }, [qc]);
  return (
    <Card className="gap-4">
      <AppText variant="h3" accessibilityRole="header">Investment wallet</AppText>
      <AppText tone="muted">{me.wallet.walletProvider ?? "Wallet"} · one wallet, one address per network</AppText>
      {me.wallet.addresses.map((a) => (
        <View key={`${a.chain}:${a.address}`} className="gap-1 border-t border-border-dark pt-3">
          <View className="flex-row items-center justify-between">
            <AppText className="font-sans-medium">{CHAINS[a.chain].label}</AppText>
            <StatusBadge tone={a.status === "active" ? "success" : "danger"} label={a.status === "active" ? "Active" : "Disabled"} />
          </View>
          <AppText tone="stone">{shortAddress(a.address)} · {METHOD[a.verificationMethod]}</AppText>
        </View>
      ))}
      {canAddChainAccount(me) && <Button variant="secondary" onPress={() => setOpen(true)}>Add chain account</Button>}
      <AppText variant="label" tone="stone">Lost access to a wallet? Contact support.</AppText>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <Screen>
          <AppText variant="h2" accessibilityRole="header">Add chain account</AppText>
          <AppText tone="muted">Connect the other network in your wallet, then sign to prove you control it.</AppText>
          {open && <WalletVerification purpose="add_chain_account" onVerified={onVerified} />}
          <Button variant="ghost" onPress={() => setOpen(false)}>Close</Button>
        </Screen>
      </Modal>
    </Card>
  );
}
```

```tsx
// contacts-section.tsx
import type { MeResponse } from "@repo/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { ContactVerifier } from "@/components/contacts/contact-verifier";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";

export function ContactsSection({ me }: { me: MeResponse }) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["me"] });
  return (
    <Card className="gap-5">
      <AppText variant="h3" accessibilityRole="header">Contacts</AppText>
      <AppText tone="muted">Required later before investing.</AppText>
      <ContactVerifier type="email" existing={me.contacts.find((c) => c.type === "email")} onVerified={refresh} />
      <ContactVerifier type="phone" existing={me.contacts.find((c) => c.type === "phone")} onVerified={refresh} />
    </Card>
  );
}
```

```tsx
// notifications-section.tsx
import type { NotificationPreferences } from "@repo/contracts";
import { palette } from "@repo/design-tokens";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";

const ITEMS: Array<{ key: keyof NotificationPreferences; label: string; hint: string }> = [
  { key: "rebalance", label: "Rebalances", hint: "New basket versions you can apply or skip" },
  { key: "portfolioUpdates", label: "Portfolio updates", hint: "Drift and execution status" },
  { key: "managerUpdates", label: "Manager updates", hint: "Strategy and commentary from managers" },
  { key: "offers", label: "Offers", hint: "Promotions and offers" },
  { key: "productUpdates", label: "Product updates", hint: "New Bytesac features" },
  { key: "marketing", label: "Marketing", hint: "News and campaigns" },
];

export function NotificationsSection() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["prefs"], queryFn: () => api.getPreferences() });
  const m = useMutation({ mutationFn: (p: Partial<NotificationPreferences>) => api.updatePreferences(p), onSuccess: (next) => qc.setQueryData(["prefs"], next) });
  return (
    <Card className="gap-4">
      <AppText variant="h3" accessibilityRole="header">Notifications</AppText>
      {isLoading && <AppText tone="stone">Loading preferences…</AppText>}
      {isError && <AppText tone="danger" accessibilityRole="alert">Couldn't load preferences. Pull to refresh or try again.</AppText>}
      {data && ITEMS.map((it) => (
        <View key={it.key} className="min-h-11 flex-row items-center justify-between gap-4">
          <View className="flex-1">
            <AppText>{it.label}</AppText>
            <AppText variant="label" tone="stone">{it.hint}</AppText>
          </View>
          <Switch accessibilityLabel={it.label} value={data[it.key]} disabled={m.isPending}
            trackColor={{ true: palette.sage, false: palette.slate }} thumbColor={palette.ivory}
            onValueChange={(v) => m.mutate({ [it.key]: v })} />
        </View>
      ))}
      <AppText variant="label" tone="stone">Security and account notices are always sent.</AppText>
    </Card>
  );
}
```

```tsx
// sessions-section.tsx
import { palette } from "@repo/design-tokens";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Smartphone } from "lucide-react-native";
import { Alert, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatRelative } from "@/lib/format";

export function SessionsSection() {
  const qc = useQueryClient();
  const { signOut } = useAuth();
  const { data } = useQuery({ queryKey: ["sessions"], queryFn: () => api.sessions() });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeSession(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }) });

  const confirmAll = () => Alert.alert(
    "Log out of all devices?",
    "Every session, including this one, ends. You'll sign in with your wallet again.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Log out everywhere", style: "destructive", onPress: async () => { await api.logoutAll().catch(() => undefined); await signOut(); } },
    ],
  );

  return (
    <Card className="gap-4">
      <AppText variant="h3" accessibilityRole="header">Sessions</AppText>
      {data?.sessions.map((s) => {
        const Icon = s.client === "mobile" ? Smartphone : Monitor;
        return (
          <View key={s.id} className="gap-2 border-t border-border-dark pt-3">
            <View className="flex-row items-center gap-2">
              <Icon size={16} color={palette.stone} />
              <AppText className="font-sans-medium">{s.client === "mobile" ? "Mobile app" : "Web"}</AppText>
              {s.current && <StatusBadge tone="success" label="This device" />}
            </View>
            <AppText variant="label" tone="stone" numberOfLines={1}>{s.userAgent ?? "Unknown device"}</AppText>
            <AppText variant="label" tone="stone">{s.ipPrefix ?? ""} · last seen {formatRelative(s.lastSeenAt)}</AppText>
            {!s.current && <Button variant="ghost" disabled={revoke.isPending} onPress={() => revoke.mutate(s.id)}>Revoke</Button>}
          </View>
        );
      })}
      <Button variant="destructive" onPress={confirmAll}>Log out all devices</Button>
    </Card>
  );
}
```

`(app)/profile.tsx`:
```tsx
import { useQuery } from "@tanstack/react-query";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { ContactsSection } from "@/components/profile/contacts-section";
import { NotificationsSection } from "@/components/profile/notifications-section";
import { SessionsSection } from "@/components/profile/sessions-section";
import { WalletSection } from "@/components/profile/wallet-section";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const { data: me, isError, refetch } = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  return (
    <Screen>
      <AppText variant="h1" accessibilityRole="header">Profile</AppText>
      {isError && <Button variant="secondary" onPress={() => void refetch()}>Retry loading profile</Button>}
      {me && <>
        <WalletSection me={me} />
        <ContactsSection me={me} />
        <NotificationsSection />
        <SessionsSection />
      </>}
      <Button variant="ghost" onPress={() => void signOut({ remote: true })}>Log out</Button>
    </Screen>
  );
}
```

- [ ] **Step 5: Run — expect PASS** (`pnpm --filter mobile test`), then **Commit**

```bash
git add apps/mobile apps/web packages/api-client
git commit -m "feat(mobile): add profile tab with wallet, contacts, notifications and sessions"
```

---

### Task 7: Mobile verification gate, manual end-to-end, docs

- [ ] **Step 1: Gate** — `pnpm --filter mobile test && pnpm --filter mobile check-types && cd apps/mobile && npx expo lint && npx expo-doctor`. All must pass.
- [ ] **Step 2: Rebuild the development build** (native deps changed since Task 2) and run against the local API (`EXPO_PUBLIC_API_URL` reachable from the device).
- [ ] **Step 3: Manual E2E checklist (record outcomes verbatim)**
  1. Fresh install → Welcome → Connect (MetaMask) → verify card shows wallet/network/address → Sign in wallet → returns to app → Contact screen (new user) → Skip → Home shows exact empty-state copy; bottom tabs Home/Profile only.
  2. Kill and reopen app → lands on Home (token restored from SecureStore).
  3. Profile → Add chain account → Phantom → sign → Solana row appears; still signed in (rotated token saved).
  4. Add phone `+…` → SMS → verify; add email → verify.
  5. Toggle Marketing → persists after app restart.
  6. Revoke the web session from Sessions; "Log out all devices" → back to Welcome.
  7. With the API, expire the session (`UPDATE app.sessions SET idle_expires_at = now() - interval '1 second'`) → next Profile refresh → Welcome with "Your session expired…" banner.
  8. Reject a signature → "Signature cancelled" → Try again works.
  9. Screen reader (TalkBack/VoiceOver) pass on sign-in and profile: every control announced with a name; status badges read their text.
- [ ] **Step 4: Docs** — if Task 2 found any Reown/Expo deviation (package versions, API names, fallback), update `docs/architecture/ARCHITECTURE.md` §8 and add a row to `docs/decisions/DECISION-REGISTER.md` in place; update the spec §12 risk bullet from "unverified" to the observed result.
- [ ] **Step 5: Commit**

```bash
git add apps/mobile docs
git commit -m "chore(mobile): pass verification gate and record Reown compatibility results"
```

---

## Self-Review Notes

- **Spec coverage:** §8.1 mobile wiring → Task 1; §8.3 wallet layer/Reown setup → Task 2 (includes the §12 compatibility gate); §8.3 routing/guards → Task 3; §8.2 screens 1–2 → Task 4, 3 → Task 5, 4 → Task 3, 5 → Task 6; §8.4 → constraints + Task 7 manual pass; §5.3 rotation on mobile → Tasks 3–4 (`acceptToken` before `VERIFIED`).
- **Shared logic:** `describeError`, `verifyReducer`, `normalizeOtp`, `chainFromCaip`, `isUserRejection`, `WalletRejectedError`, `ConnectedAccount`, `canAddChainAccount` all live in `@repo/api-client`; neither app redefines them.
- **Open item carried forward:** bundle identifiers and production metadata URL/icons need product-owner confirmation before any store build.
