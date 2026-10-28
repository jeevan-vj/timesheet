import { StyleSheet, Text } from "react-native";
import { statusPillTone, type StatusPillLabel } from "@/ui/status-tone";
import { spacing, statusColors, theme, typeScale } from "@/ui/tokens";

export function StatusPill({ label }: { label: StatusPillLabel }) {
  const color = statusColors[statusPillTone(label)];
  return (
    <Text accessibilityLabel={`Status: ${label}`} style={[styles.pill, { borderColor: color, color }]}>
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    backgroundColor: theme.surfaceRaised,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    fontSize: typeScale.caption,
    lineHeight: 18,
    fontWeight: "700",
    overflow: "hidden",
  },
});
