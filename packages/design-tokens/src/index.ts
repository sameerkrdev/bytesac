/**
 * Single TS source of Bytesac design tokens. The web design system is documented in docs/design/DESIGN-SYSTEM.md;
 * apps/web/app/globals.css mirrors `themes`, `radius`, `shadow` and `motion` (checked by apps/web/test/tokens.test.ts).
 */

/** Semantic colour roles. Every role exists in both themes; components use roles, never raw hex. */
export type ThemeRole =
  | "canvas" | "surface" | "surfaceMuted" | "surfaceSunken"
  | "line" | "lineStrong"
  | "ink" | "inkMuted" | "inkFaint"
  | "primary" | "primaryHover" | "primaryInk"
  | "accent" | "accentSoft"
  | "sky1" | "sky2" | "sky3" | "skyTop" | "skyMid" | "skyLow"
  | "glass" | "glassLine"
  | "success" | "successSoft" | "warning" | "warningSoft" | "danger" | "dangerSoft" | "info" | "infoSoft"
  | "focus" | "overlay"
  | "data1" | "data2" | "data3" | "data4" | "data5" | "data6";

export const themes: Record<"light" | "dark", Record<ThemeRole, string>> = {
  light: {
    canvas: "#F6F8FB",
    surface: "#FFFFFF",
    surfaceMuted: "#F0F3F8",
    surfaceSunken: "#E9EEF5",
    line: "#E2E7EF",
    lineStrong: "#CBD3DF",
    ink: "#0F1E3A",
    inkMuted: "#56627A",
    inkFaint: "#68728A",
    primary: "#1C2B4A",
    primaryHover: "#2E4470",
    primaryInk: "#FFFFFF",
    accent: "#3D63D9",
    accentSoft: "#E8EEFC",
    sky1: "#EEF4FA",
    sky2: "#DCE8F4",
    sky3: "#BFD5EC",
    skyTop: "#78ADE2",
    skyMid: "#A9CBEC",
    skyLow: "#DCEAF7",
    glass: "rgba(255, 255, 255, 0.62)",
    glassLine: "rgba(255, 255, 255, 0.78)",
    success: "#1F8A4C",
    successSoft: "#E3F4EA",
    warning: "#A35F0F",
    warningSoft: "#FBF0DD",
    danger: "#C2453D",
    dangerSoft: "#FBE7E5",
    info: "#3D63D9",
    infoSoft: "#E8EEFC",
    focus: "#3D63D9",
    overlay: "rgba(15, 30, 58, 0.32)",
    data1: "#1C2B4A",
    data2: "#3D63D9",
    data3: "#6F93D6",
    data4: "#A9C2E6",
    data5: "#4F6B8F",
    data6: "#C9D5E3",
  },
  dark: {
    canvas: "#070D18",
    surface: "#0E1726",
    surfaceMuted: "#131E31",
    surfaceSunken: "#0A111E",
    line: "#1E2A3F",
    lineStrong: "#2C3A52",
    ink: "#EAF0F8",
    inkMuted: "#9AA7BC",
    inkFaint: "#8390A6",
    primary: "#EAF0F8",
    primaryHover: "#FFFFFF",
    primaryInk: "#0B1424",
    accent: "#8AA6FF",
    accentSoft: "rgba(138, 166, 255, 0.14)",
    sky1: "#0B1424",
    sky2: "#12203A",
    sky3: "#1D3157",
    skyTop: "#040A15",
    skyMid: "#0B1931",
    skyLow: "#1A2E52",
    glass: "rgba(20, 31, 51, 0.58)",
    glassLine: "rgba(255, 255, 255, 0.09)",
    success: "#4CC38A",
    successSoft: "rgba(76, 195, 138, 0.14)",
    warning: "#E8A54B",
    warningSoft: "rgba(232, 165, 75, 0.14)",
    danger: "#F07A72",
    dangerSoft: "rgba(240, 122, 114, 0.14)",
    info: "#8AA6FF",
    infoSoft: "rgba(138, 166, 255, 0.14)",
    focus: "#8AA6FF",
    overlay: "rgba(2, 6, 14, 0.62)",
    data1: "#EAF0F8",
    data2: "#8AA6FF",
    data3: "#5D7FD1",
    data4: "#3B5A93",
    data5: "#A9B8CF",
    data6: "#2A3B58",
  },
};

/** Radii in px: shell, card, tile, control, pill. */
export const radius = { shell: 28, card: 20, tile: 14, control: 12, pill: 999 } as const;

/** Shadow recipes (light theme; dark theme drops them to near-invisible and relies on lines). */
export const shadow = {
  soft: "0 1px 2px rgba(15, 30, 58, 0.04), 0 12px 32px -12px rgba(15, 30, 58, 0.10)",
  float: "0 1px 2px rgba(15, 30, 58, 0.05), 0 32px 64px -24px rgba(15, 30, 58, 0.22)",
  device: "0 48px 96px -32px rgba(28, 43, 74, 0.35)",
} as const;

/** Motion tokens derived in docs/design/MOTION-STUDY.md. Durations in ms. */
export const motion = {
  ease: { out: [0.22, 1, 0.36, 1], inOut: [0.65, 0, 0.35, 1] },
  duration: { fast: 160, base: 320, slow: 700, hero: 1100 },
  stagger: { line: 120, item: 80 },
} as const;

export const fontFamily = { sans: "Geist", mono: "Geist Mono" } as const;

/**
 * Legacy dark palette, still used by apps/mobile until its redesign (brief phase 13). The web no longer uses it.
 * @deprecated web: use `themes`.
 */
export const palette = {
  space: "#0B1117",
  slate: "#1F2937",
  stone: "#6B7280",
  sage: "#10B981",
  mint: "#6EE7B7",
  sand: "#EEDCC8",
  ivory: "#FAFAF8",
} as const;

/** @deprecated web: use `themes`. Mobile only (see `palette`). */
export const semantic = {
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#F87171",
  info: "#60A5FA",
  borderDark: "#26323D",
  overlay: "rgba(5, 9, 13, 0.72)",
} as const;

/** @deprecated web: use `themes`. Mobile only. */
export const surfaces = { card: "#111B24", mutedForeground: "#A1AAB5" } as const;

/** @deprecated web: use `radius`. Mobile only. */
export const radii = { sm: 8, md: 12, lg: 16, xl: 20, "2xl": 24, pill: 999 } as const;

/** @deprecated web: use `fontFamily`. Mobile only. */
export const fonts = { display: "Manrope", body: "Inter" } as const;
