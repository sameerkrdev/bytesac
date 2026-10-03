/**
 * The web app's origin for "Continue on web" handoffs. There is deliberately no default: when EXPO_PUBLIC_WEB_URL is unset, `webUrl` returns null and callers
 * show plain text instead of a link, so users are never sent to an unconfirmed domain (see docs/OPEN-ITEMS.md).
 */
export const WEB_HANDOFF_TEXT = "Use the Bytesac web app to continue";
export function webUrl(path: string): string | null {
  const origin = process.env.EXPO_PUBLIC_WEB_URL?.trim().replace(/[/]+$/, "");
  return origin ? `${origin}${path}` : null;
}
