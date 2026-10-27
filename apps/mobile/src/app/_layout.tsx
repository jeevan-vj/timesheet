import { DarkTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { ScreenError } from "@/components/screen-error";
import { theme } from "@/theme";

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: theme.background,
    card: theme.surface,
    primary: theme.accent,
    text: theme.text,
    border: theme.surfaceRaised,
    notification: theme.accent,
  },
};

export default function RootLayout() {
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.background);
  }, []);
  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }} />
    </ThemeProvider>
  );
}

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.fill}>
      <ScreenError retry={retry} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: theme.background,
  },
});
