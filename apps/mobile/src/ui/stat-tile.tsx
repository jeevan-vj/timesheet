import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { spacing, theme, typeScale } from "@/ui/tokens";

export function StatTile({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={styles.value}>
        {value}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 132,
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderCurve: "continuous",
    padding: spacing.md,
    gap: spacing.xs,
  },
  label: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.caption,
    lineHeight: 18,
    fontWeight: "700",
  },
  value: {
    color: theme.text,
    fontSize: typeScale.title,
    lineHeight: 28,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
