/** Single TS source of BYTESAC tokens. Values copied verbatim from docs/BYTESAC_Design_System.md. */
export const palette = {
  space: "#0B1117",
  slate: "#1F2937",
  stone: "#6B7280",
  sage: "#10B981",
  mint: "#6EE7B7",
  sand: "#EEDCC8",
  ivory: "#FAFAF8",
} as const;

export const semantic = {
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#F87171",
  info: "#60A5FA",
  borderDark: "#26323D",
  overlay: "rgba(5, 9, 13, 0.72)",
} as const;

/** Derived surfaces from design system §11 (`--card`, `--muted-foreground`). */
export const surfaces = { card: "#111B24", mutedForeground: "#A1AAB5" } as const;

/** Radii in px (design system §5). */
export const radii = { sm: 8, md: 12, lg: 16, xl: 20, "2xl": 24, pill: 999 } as const;

export const fonts = { display: "Manrope", body: "Inter" } as const;

export type PaletteColor = keyof typeof palette;
