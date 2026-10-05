import AsyncStorage from "@react-native-async-storage/async-storage";
import { themes, type ThemeRole } from "@repo/design-tokens";
import { VariableContextProvider } from "nativewind";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance, useColorScheme } from "react-native";

/*
 * Light / dark / system, like the web's appearance switch. The choice is stored on the device and applied through
 * React Native's Appearance API; the resolved scheme feeds NativeWind's CSS variables (every role class follows it)
 * and `useTheme().colors` for places that need raw values (icons, navigators, gradients).
 */

export type ThemeChoice = "light" | "dark" | "system";
type Scheme = "light" | "dark";
const KEY = "bx_theme";

const kebab = (r: string) => r.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
/** NativeWind variables for a scheme: `--color-<role>` → token value. */
export const themeVars = (scheme: Scheme): Record<string, string> =>
  Object.fromEntries((Object.entries(themes[scheme]) as [ThemeRole, string][]).map(([role, value]) => [`--color-${kebab(role)}`, value]));

const VARS = { light: themeVars("light"), dark: themeVars("dark") };

type Ctx = { scheme: Scheme; colors: Record<ThemeRole, string>; choice: ThemeChoice; setChoice(c: ThemeChoice): void };
const ThemeContext = createContext<Ctx>({ scheme: "light", colors: themes.light, choice: "system", setChoice: () => undefined });

/** Native status bar, keyboards and system sheets follow the choice; React Native Web has no setColorScheme, so there the resolved scheme below is all. */
const apply = (c: ThemeChoice) => { if (typeof Appearance.setColorScheme === "function") Appearance.setColorScheme(c === "system" ? "unspecified" : c); };

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>("system");
  const system: Scheme = useColorScheme() === "dark" ? "dark" : "light";
  const scheme: Scheme = choice === "system" ? system : choice;

  useEffect(() => {
    // A failed read keeps the system default; nothing else depends on it.
    AsyncStorage.getItem(KEY).then((v) => {
      if (v === "light" || v === "dark" || v === "system") { setChoiceState(v); apply(v); }
    }).catch(() => undefined);
  }, []);

  const setChoice = useCallback((c: ThemeChoice) => {
    setChoiceState(c);
    apply(c);
    AsyncStorage.setItem(KEY, c).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ scheme, colors: themes[scheme], choice, setChoice }), [scheme, choice, setChoice]);
  return (
    <ThemeContext.Provider value={value}>
      <VariableContextProvider value={VARS[scheme]}>{children}</VariableContextProvider>
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
