import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => cleanup());

// jsdom has no matchMedia; the theme store and motion helpers read prefers-color-scheme / prefers-reduced-motion.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  }) as MediaQueryList;
}

// jsdom has no IntersectionObserver; motion's whileInView needs one. Elements simply never "enter" in tests.
if (typeof window !== "undefined" && !("IntersectionObserver" in window)) {
  class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ""; thresholds = []; }
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
}

// Server pages read the request cookies (session, preview gate) to call the API; outside a request there are none.
// A test that needs a session mocks next/headers itself.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
