/** The web app's origin, for "Continue on web" handoffs (Bitcoin legs, Bitcoin linking, manager and ops areas). */
const origin = (process.env.EXPO_PUBLIC_WEB_URL || "https://bytesac.com").replace(/\/+$/, "");
export const webUrl = (path: string): string => `${origin}${path}`;
