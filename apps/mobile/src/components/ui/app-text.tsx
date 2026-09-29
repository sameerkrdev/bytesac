import { Text, type TextProps } from "react-native";

const VARIANTS = {
  display: "font-display text-4xl leading-[44px]",
  h1: "font-display text-3xl leading-[38px]",
  h2: "font-display text-[28px] leading-9",
  h3: "font-display-semibold text-[22px] leading-[30px]",
  h4: "font-display-semibold text-lg leading-[26px]",
  bodyLarge: "font-sans text-base leading-[26px]",
  body: "font-sans text-sm leading-[22px]",
  label: "font-sans-medium text-xs leading-[18px]",
  micro: "font-sans text-[11px] leading-4",
} as const;
const TONES = { ivory: "text-ivory", stone: "text-stone", muted: "text-muted-foreground", mint: "text-mint", danger: "text-danger", space: "text-space" } as const;

export function AppText({ variant = "body", tone = "ivory", className = "", ...rest }: TextProps & { variant?: keyof typeof VARIANTS; tone?: keyof typeof TONES; className?: string }) {
  return <Text {...rest} className={`${VARIANTS[variant]} ${TONES[tone]} ${className}`} />;
}
