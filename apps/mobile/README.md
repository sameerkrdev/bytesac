# Bytesac mobile

Expo (SDK 57) app for Bytesac. It uses Reown AppKit (WalletConnect, Phantom, Solflare), which includes native modules, so **Expo Go is not supported**. Use a development build (`npx expo run:android` or `npx eas-cli@latest build --profile development`), then `npx expo start --dev-client`.

## Environment variables

Copy `.env.example` to `.env`.

- `EXPO_PUBLIC_API_URL`: Bytesac API base URL (Android emulator: `http://10.0.2.2:4000`).
- `EXPO_PUBLIC_REOWN_PROJECT_ID`: Reown (WalletConnect) Cloud project ID.

### Development build

`EXPO_PUBLIC_*` values are inlined at build time, so they must exist when the development build is created (or when Metro bundles). Provide them either as EAS environment variables (`eas env:create`, environment `development`) for `eas build --profile development`, or in a local `.env` for `npx expo run:android|ios`. `eas.json` already sets `EXPO_PUBLIC_API_URL` for the Android emulator; JSON has no comments, so `EXPO_PUBLIC_REOWN_PROJECT_ID` is documented here only. Without it wallet connection will not work.

## Commands

```bash
pnpm --filter mobile test
pnpm --filter mobile check-types
npx expo-doctor
```
