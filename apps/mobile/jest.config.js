/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFiles: ["./test/setup.ts"],
  // The first render in a file pays for a cold transform (slow on Windows); 5 s made those first tests flaky.
  testTimeout: 15_000,
  testMatch: ["<rootDir>/test/**/*.test.ts?(x)"],
  moduleNameMapper: { "^lucide-react-native$": "<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js", "^@/(.*)$": "<rootDir>/src/$1", "\\.css$": "<rootDir>/test/style-mock.js" },
  transformIgnorePatterns: [
    "node_modules/(?!(?:\\.pnpm/[^/]+/node_modules/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|expo-router|react-navigation|@react-navigation/.*|@repo/.*|lucide-react-native|zod|react-native-svg|nativewind|react-native-css))",
  ],
};
