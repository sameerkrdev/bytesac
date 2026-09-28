import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ExternalLink } from "@/components/external-link";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Collapsible } from "@/components/ui/collapsible";
import { WebBadge } from "@/components/web-badge";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export default function ExploreScreen() {
  const safeAreaInsets = useSafeAreaInsets();
  const theme = useTheme();

  const insets = {
    ...safeAreaInsets,
    bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
  };

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: theme.background }}
      contentInset={insets}
      contentContainerClassName="flex-row justify-center"
      contentContainerStyle={Platform.select({
        android: {
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          paddingBottom: insets.bottom,
        },
        web: {
          paddingTop: Spacing.six,
          paddingBottom: Spacing.four,
        },
      })}
    >
      <ThemedView className="flex-grow" style={{ maxWidth: MaxContentWidth }}>
        {/* Header */}
        <View className="items-center gap-3 px-4 py-6">
          <ThemedText type="subtitle">Explore</ThemedText>

          <ThemedText className="text-center" themeColor="textSecondary">
            This starter app includes example{"\n"}
            code to help you get started.
          </ThemedText>

          <ExternalLink href="https://docs.expo.dev" asChild>
            <Pressable className="active:opacity-70">
              <ThemedView
                type="backgroundElement"
                className="flex-row items-center justify-center gap-1 rounded-xl px-4 py-2"
              >
                <ThemedText type="link">Expo documentation</ThemedText>

                <SymbolView
                  tintColor={theme.text}
                  name={{
                    ios: "arrow.up.right.square",
                    android: "link",
                    web: "link",
                  }}
                  size={12}
                />
              </ThemedView>
            </Pressable>
          </ExternalLink>
        </View>

        {/* Sections */}
        <View className="gap-5 px-4 pt-3">
          <Collapsible title="File-based routing">
            <View className="gap-2">
              <ThemedText type="small">
                This app has two screens: <ThemedText type="code">src/app/index.tsx</ThemedText> and{" "}
                <ThemedText type="code">src/app/explore.tsx</ThemedText>
              </ThemedText>

              <ThemedText type="small">
                The layout file in <ThemedText type="code">src/app/_layout.tsx</ThemedText> sets up
                the tab navigator.
              </ThemedText>

              <ExternalLink href="https://docs.expo.dev/router/introduction">
                <ThemedText type="linkPrimary">Learn more</ThemedText>
              </ExternalLink>
            </View>
          </Collapsible>

          <Collapsible title="Android, iOS, and web support">
            <ThemedView type="backgroundElement" className="items-center gap-2">
              <ThemedText type="small">
                You can open this project on Android, iOS, and the web. To open the web version,
                press <ThemedText type="smallBold">w</ThemedText> in the terminal running this
                project.
              </ThemedText>

              <Image
                source={require("@/assets/images/tutorial-web.png")}
                className="mt-2 aspect-[296/171] w-full rounded-xl"
              />
            </ThemedView>
          </Collapsible>

          <Collapsible title="Images">
            <View className="gap-2">
              <ThemedText type="small">
                For static images, you can use the <ThemedText type="code">@2x</ThemedText> and{" "}
                <ThemedText type="code">@3x</ThemedText> suffixes to provide files for different
                screen densities.
              </ThemedText>

              <Image
                source={require("@/assets/images/react-logo.png")}
                className="h-[100px] w-[100px] self-center"
              />

              <ExternalLink href="https://reactnative.dev/docs/images">
                <ThemedText type="linkPrimary">Learn more</ThemedText>
              </ExternalLink>
            </View>
          </Collapsible>

          <Collapsible title="Light and dark mode components">
            <View className="gap-2">
              <ThemedText type="small">
                This template has light and dark mode support. The{" "}
                <ThemedText type="code">useColorScheme()</ThemedText> hook lets you inspect the
                current color scheme and adjust UI colors accordingly.
              </ThemedText>

              <ExternalLink href="https://docs.expo.dev/develop/user-interface/color-themes/">
                <ThemedText type="linkPrimary">Learn more</ThemedText>
              </ExternalLink>
            </View>
          </Collapsible>

          <Collapsible title="Animations">
            <ThemedText type="small">
              This template includes an example of an animated component. The{" "}
              <ThemedText type="code">src/components/ui/collapsible.tsx</ThemedText> component uses{" "}
              <ThemedText type="code">react-native-reanimated</ThemedText> to animate opening this
              hint.
            </ThemedText>
          </Collapsible>
        </View>

        {Platform.OS === "web" && <WebBadge />}
      </ThemedView>
    </ScrollView>
  );
}
