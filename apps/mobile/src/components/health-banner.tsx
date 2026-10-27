import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { mobileFetch } from "@/api";
import { theme } from "@/theme";

export function HealthBanner() {
  const [label, setLabel] = useState("Checking connection");

  useEffect(() => {
    let active = true;
    mobileFetch("/api/health")
      .then((response) => {
        if (active) setLabel(response.ok ? "Connected" : "API unavailable");
      })
      .catch(() => {
        if (active) setLabel("Offline");
      });
    return () => {
      active = false;
    };
  }, []);

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
