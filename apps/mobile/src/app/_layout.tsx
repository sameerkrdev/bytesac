import "@/lib/polyfills";
import "@/global.css";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { Manrope_600SemiBold, Manrope_700Bold } from "@expo-google-fonts/manrope";
import { AppKit } from "@reown/appkit-react-native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { palette } from "@repo/design-tokens";
import { AuthProvider } from "@/lib/auth-context";
import { appKit, WalletProviders } from "@/lib/appkit";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({ Manrope_600SemiBold, Manrope_700Bold, Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  useEffect(() => { if (loaded || error) void SplashScreen.hideAsync(); }, [loaded, error]);
  if (!loaded && !error) return null;
  return (
    <SafeAreaProvider>
      <AuthProvider disconnectWallet={() => appKit.disconnect()}>
        <WalletProviders>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.space } }} />
          <AppKit />
        </WalletProviders>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
