import { DarkTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { ScreenError } from "@/components/screen-error";
import { authClient } from "@/auth-client";
import { PortalQueryProvider } from "@/query-client";
import { theme } from "@/theme";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

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
    <PortalQueryProvider>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style="light" />
        <RootNavigator />
      </ThemeProvider>
    </PortalQueryProvider>
  );
}

function RootNavigator() {
  const { data, isPending } = authClient.useSession();
  useEffect(() => {
    if (!isPending) void SplashScreen.hideAsync().catch(() => undefined);
  }, [isPending]);
  if (isPending) return <View style={styles.fill} />;
  const signedIn = Boolean(data?.user);
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
      <Stack.Protected guard={signedIn} redirectTo="/sign-in">
        <Stack.Screen name="(contractor)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn} redirectTo="/">
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
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
