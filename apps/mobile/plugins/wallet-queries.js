const { withAndroidManifest, createRunOncePlugin } = require("expo/config-plugins");

const packages = [
  { $: { "android:name": "io.metamask" } },
  { $: { "android:name": "com.wallet.crypto.trustapp" } },
  { $: { "android:name": "me.rainbow" } },
  { $: { "android:name": "app.phantom" } },
  { $: { "android:name": "com.solflare.mobile" } },
];

const withWalletQueries = (config) =>
  withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    const list = Array.isArray(manifest.queries) ? manifest.queries : manifest.queries ? [manifest.queries] : [];
    const idx = Math.max(0, list.findIndex((q) => q && Array.isArray(q.package)));
    const existing = list[idx] && typeof list[idx] === "object" ? list[idx] : {};
    const current = existing.package ?? [];
    const known = new Set(current.map((p) => p.$["android:name"]));
    const merged = { ...existing, package: [...current, ...packages.filter((p) => !known.has(p.$["android:name"]))] };
    const next = [...list];
    next[idx] = merged;
    manifest.queries = next;
    return c;
  });

module.exports = createRunOncePlugin(withWalletQueries, "withWalletQueries", "1.2.0");
