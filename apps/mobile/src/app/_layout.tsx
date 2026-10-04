import "@/lib/polyfills";
import "@/global.css";
import { Geist_300Light, Geist_400Regular, Geist_500Medium, Geist_600SemiBold } from "@expo-google-fonts/geist";
import { GeistMono_400Regular, GeistMono_500Medium } from "@expo-google-fonts/geist-mono";
import { AppKit } from "@reown/appkit-react-native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/lib/auth-context";
import { appKit, WalletProviders } from "@/lib/appkit";
import { ThemeProvider, useTheme } from "@/lib/theme";

SplashScreen.preventAutoHideAsync();

/** Status bar, root background and stack colours follow the theme. */
function ThemedStack() {
  const { scheme, colors } = useTheme();
  useEffect(() => { void SystemUI.setBackgroundColorAsync(colors.canvas).catch(() => undefined); }, [colors.canvas]);
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />
    </>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({ Geist_300Light, Geist_400Regular, Geist_500Medium, Geist_600SemiBold, GeistMono_400Regular, GeistMono_500Medium });
  useEffect(() => { if (loaded || error) void SplashScreen.hideAsync(); }, [loaded, error]);
  if (!loaded && !error) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider disconnectWallet={() => appKit.disconnect()}>
          <WalletProviders>
            <ThemedStack />
            <AppKit />
          </WalletProviders>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
