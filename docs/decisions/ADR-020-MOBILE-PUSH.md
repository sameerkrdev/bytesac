# ADR-020: Mobile push through the Expo push service

- **Status:** APPROVED
- **Date:** 2026-10-05
- **Owners:** Product owner (user), engineering
- **Related:** ADR-015 §8 (notifications and web push, D-083), D-118, `docs/design/MOBILE-UX-INVENTORY.md` row 35

## Context
ADR-015 delivers every notification as an inbox row, then email and FCM web push, and deferred mobile push. The Expo app
now has the full investor experience, and the inbox already maps every notification link to a mobile screen
(`apps/mobile/src/lib/notification-route.ts`). iOS push needs APNs and Android push needs FCM; the API already holds an
FCM sender for browsers (`firebase-admin`).

## Decision
The user chose (2026-10-05):

1. **Provider:** the Expo push service. The app (`expo-notifications`, `expo-device`) gets an Expo push token per
   device (`getExpoPushTokenAsync` with the EAS project id); the API posts to `https://exp.host/--/api/v2/push/send` in
   batches of at most 100 (`apps/api/src/providers/expo-push.ts`). APNs and FCM credentials live in EAS, not on our
   servers. `EXPO_ACCESS_TOKEN` (Expo enhanced push security) is optional.
2. **Storage:** `push_tokens` gains `platform` (`web` | `ios` | `android`) and `provider` (`fcm` | `expo`), migration
   `0020_mobile_push.sql`; existing rows default to `web` / `fcm`. The API body schema keeps web unchanged (both fields
   default) and refuses an Expo token from the web, a malformed Expo token, or FCM from the app.
3. **Content:** the same title and body as the inbox row, plus `data: { link, notificationId }`. The link is the web
   path; the app maps it with `mobileRoute` and marks the row read when the push is tapped.
4. **Consent:** push is opt-in on each device (Profile → Notifications switch, or the Alerts banner); the OS prompt
   appears only after that tap. Kind preferences gate push exactly like email and web push. Turning the switch off and
   signing out revoke the device's token (revoked, never deleted).

## Alternatives considered
- Native FCM through `firebase-admin` with `@react-native-firebase/messaging`: no new processor, but heavier native setup
  (google-services files, more packages) and iOS FCM tokens need APNs configured in Firebase anyway.
- Android only through FCM device tokens: smallest change, but iOS users get nothing.
- Generic text ("You have a new notification"): nothing about baskets leaves our servers, but the user preferred the
  inbox wording (as web push already does).

## Consequences
### Positive
- One sender covers iOS and Android; no Apple or Google credentials on the API.
- The web client, its tokens and FCM delivery are unchanged.

### Negative / trade-offs
- Expo becomes a data processor for notification titles and bodies (basket names) and device tokens.
- Delivery receipts are not polled: only `DeviceNotRegistered` returned at send time revokes a token.
- Push needs a development or store build with an EAS project id; it does not work in Expo Go or on web.

### Security, financial and operational impact
- Push never states that a trade happened (ADR-015 copy rules) and is never an authorization: tapping it only opens a
  screen. Tokens are untrusted input validated at the route and are never logged.
- `EXPO_ACCESS_TOKEN`, when used, is a secret in the API environment.

## Migration / rollout
- Run migration `0020_mobile_push.sql` (additive; defaults backfill existing rows).
- `eas init` in `apps/mobile` (writes `extra.eas.projectId`), upload the FCM v1 service-account key and the APNs key to
  EAS credentials, then build with EAS. Until then the app shows "Push isn't set up in this build yet".
- Optionally enable push security in Expo and set `EXPO_ACCESS_TOKEN` on the API and worker.

## Validation
- Validator tests for the token schema; API tests for provider routing, preference gating, dead-token revocation and
  the provider's batching and error handling; mobile tests for opt-in, denial, revoke on switch-off and sign-out, the
  unconfigured state and tap routing.
- On device (user): permission prompt, a real push for each kind, tap navigation from a cold start.

## Open questions
- Poll push receipts (15 minutes after sending) to revoke tokens Expo only reports later.
- Badge counts on the app icon.
