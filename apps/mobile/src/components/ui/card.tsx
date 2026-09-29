import { View, type ViewProps } from "react-native";
export function Card({ className = "", ...rest }: ViewProps & { className?: string }) {
  return <View {...rest} className={`rounded-2xl border border-border-dark bg-slate p-5 ${className}`} />;
}
