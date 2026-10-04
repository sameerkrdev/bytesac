"use client";

import { useSyncExternalStore } from "react";

/** The user's choice. `system` follows the OS. Persisted in a cookie so the server renders the right `data-theme`. */
export type ThemeChoice = "light" | "dark" | "system";
export const THEME_COOKIE = "bx_theme";
const EVENT = "bx:theme";

export function readChoice(): ThemeChoice {
  const v = /(?:^|;\s*)bx_theme=(light|dark|system)/.exec(document.cookie)?.[1];
  return (v as ThemeChoice | undefined) ?? "system";
}

/** What is actually on screen. */
export function resolvedTheme(): "light" | "dark" {
  const forced = document.documentElement.dataset.theme;
  if (forced === "light" || forced === "dark") return forced;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function setChoice(choice: ThemeChoice) {
  document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=31536000; samesite=lax`;
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(EVENT, cb);
  mq.addEventListener("change", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    mq.removeEventListener("change", cb);
  };
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, readChoice, () => "system");
}

export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribe, resolvedTheme, () => "light");
}
