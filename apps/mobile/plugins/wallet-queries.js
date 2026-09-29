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
