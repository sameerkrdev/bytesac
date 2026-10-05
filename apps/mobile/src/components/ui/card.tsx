import { View, type ViewProps } from "react-native";

/** A soft surface: white on the light canvas, deep navy in dark. */
export function Card({ className = "", ...rest }: ViewProps & { className?: string }) {
  return <View {...rest} className={`rounded-card border border-line bg-surface p-5 ${className}`} />;
}
