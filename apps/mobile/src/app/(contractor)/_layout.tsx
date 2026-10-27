import { Stack } from "expo-router";
import { theme } from "@/theme";

export default function ContractorLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="upcoming" />
    </Stack>
  );
}
