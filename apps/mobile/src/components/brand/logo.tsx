import { Image } from "expo-image";
export function Logo({ size = 40 }: { size?: number }) {
  return <Image source={require("../../../assets/images/logo.png")} style={{ width: size, height: size }} accessibilityLabel="Bytesac" contentFit="contain" />;
}
