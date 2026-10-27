import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { theme } from "@/theme";

function idleLabel(baseUrl: string | undefined): string | null {
  if (!baseUrl) return "API not configured";
  return null;
}

export function HealthBanner() {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;
  const [label, setLabel] = useState(idleLabel(baseUrl) ?? "Checking connection");

  useEffect(() => {
    if (!baseUrl) return;
    let active = true;
    const url = `${baseUrl.replace(/\/$/, "")}/api/health`;
    fetch(url)
      .then((response) => {
        if (active) setLabel(response.ok ? "Connected" : "API unavailable");
      })
      .catch(() => {
        if (active) setLabel("Offline");
      });
    return () => {
      active = false;
    };
  }, [baseUrl]);

  return (
    <Text accessibilityRole="text" style={styles.banner}>
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  banner: {
    color: theme.muted,
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    paddingVertical: 12,
    paddingHorizontal: 16,
    overflow: "hidden",
  },
});
