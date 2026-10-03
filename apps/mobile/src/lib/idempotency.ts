/** A fresh idempotency key (32 hex chars). Hermes has no `crypto.randomUUID`; `getRandomValues` comes from react-native-get-random-values. */
export const newKey = (): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
