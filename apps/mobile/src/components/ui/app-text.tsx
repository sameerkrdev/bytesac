import { Text, type TextProps } from "react-native";

/** The type scale, after the web's (light display weights, mono eyebrows, tabular figures). */
const VARIANTS = {
  hero: "font-light text-[40px] leading-[44px] tracking-tight",
  display: "font-light text-[32px] leading-[38px] tracking-tight",
  title: "font-light text-[26px] leading-[32px] tracking-tight",
  heading: "font-medium text-lg leading-6",
  lede: "font-sans text-[17px] leading-[26px]",
  bodyLarge: "font-sans text-base leading-6",
  body: "font-sans text-[15px] leading-[22px]",
  label: "font-medium text-[13px] leading-[18px]",
  eyebrow: "font-mono text-[11px] leading-4 uppercase tracking-widest",
  figure: "font-light text-[34px] leading-[40px] tracking-tight",
  buttonLabel: "font-medium text-[15px] leading-5",
  micro: "font-sans text-[11px] leading-4",
} as const;

const TONES = {
  ink: "text-ink", muted: "text-ink-muted", faint: "text-ink-faint", accent: "text-accent",
  success: "text-success", warning: "text-warning", danger: "text-danger", primaryInk: "text-primary-ink",
} as const;

export type TextVariant = keyof typeof VARIANTS;
export type TextTone = keyof typeof TONES;

export function AppText({ variant = "body", tone = "ink", className = "", ...rest }: TextProps & { variant?: TextVariant; tone?: TextTone; className?: string }) {
  return <Text {...rest} className={`${VARIANTS[variant]} ${TONES[tone]} ${className}`} />;
}
