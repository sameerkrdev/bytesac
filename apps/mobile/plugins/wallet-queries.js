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
    const first = Array.isArray(manifest.queries) ? manifest.queries[0] : manifest.queries;
    const existing = first && typeof first === "object" ? first : {};
    const current = existing.package ?? [];
    const known = new Set(current.map((p) => p.$["android:name"]));
    manifest.queries = [{ ...existing, package: [...current, ...packages.filter((p) => !known.has(p.$["android:name"]))] }];
    return c;
  });

module.exports = createRunOncePlugin(withWalletQueries, "withWalletQueries", "1.1.0");
