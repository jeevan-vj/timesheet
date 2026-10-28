import { DarkTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { RouteErrorBoundary, ScreenErrorBoundary } from "@/components/route-error-boundary";
import { reportScreenError } from "@/report-screen-error";
import { authClient } from "@/auth-client";
import { PortalQueryProvider } from "@/query-client";
import { workspaceForRole } from "@/role-route";
import { theme } from "@/theme";
import { ErrorState } from "@/ui";
import { useViewer } from "@/use-viewer";

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
    <ScreenErrorBoundary>
      <PortalQueryProvider>
        <ThemeProvider value={navigationTheme}>
          <StatusBar style="light" />
          <RootNavigator />
        </ThemeProvider>
      </PortalQueryProvider>
    </ScreenErrorBoundary>
  );
}

function RootNavigator() {
  const { data, isPending } = authClient.useSession();
  useEffect(() => {
    if (!isPending && !data?.user) void SplashScreen.hideAsync().catch(() => undefined);
  }, [data?.user, isPending]);
  if (isPending) return <View style={styles.fill} />;
  const signedIn = Boolean(data?.user);
  if (signedIn) return <SignedInNavigator />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
      <Stack.Protected guard redirectTo="/">
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={false}>
        <Stack.Screen name="(contractor)" />
        <Stack.Screen name="(owner)" />
        <Stack.Screen name="(none)" />
      </Stack.Protected>
    </Stack>
  );
}

function SignedInNavigator() {
  const viewer = useViewer();
  useEffect(() => {
    if (viewer.status !== "loading") void SplashScreen.hideAsync().catch(() => undefined);
  }, [viewer.status]);
  if (viewer.status === "loading") return <View style={styles.fill} />;
  if (viewer.status === "error") {
    return (
      <View style={styles.viewerError}>
        <ErrorState message="We couldn't identify your workspace." onRetry={() => void viewer.reload()} />
      </View>
    );
  }
  const workspace = workspaceForRole(viewer.role);
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
      <Stack.Protected guard={false}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={workspace === "contractor"}>
        <Stack.Screen name="(contractor)" />
      </Stack.Protected>
      <Stack.Protected guard={workspace === "owner"}>
        <Stack.Screen name="(owner)" />
      </Stack.Protected>
      <Stack.Protected guard={workspace === "none"}>
        <Stack.Screen name="(none)" />
      </Stack.Protected>
    </Stack>
  );
}

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    reportScreenError(error);
  }, [error]);
  return <RouteErrorBoundary error={error} retry={retry} />;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: theme.background,
  },
  viewerError: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: theme.background,
    padding: 20,
  },
});
