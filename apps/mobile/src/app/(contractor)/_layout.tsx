import { Stack } from "expo-router";
import { ErrorBoundary, ScreenErrorBoundary } from "@/components/route-error-boundary";
import { theme } from "@/theme";

export { ErrorBoundary };

export const unstable_settings = {
  screenErrorBoundary: ErrorBoundary,
};

export default function ContractorLayout() {
  return (
    <ScreenErrorBoundary>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="upcoming"
          options={{
            headerShown: true,
            title: "Upcoming",
            headerBackTitle: "Back",
            headerTintColor: theme.accent,
            headerStyle: { backgroundColor: theme.background },
            headerTitleStyle: { color: theme.text },
            headerShadowVisible: false,
          }}
        />
      </Stack>
    </ScreenErrorBoundary>
  );
}
