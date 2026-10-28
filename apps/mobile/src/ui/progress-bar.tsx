import { StyleSheet, View } from "react-native";
import { theme } from "@/ui/tokens";

export function ProgressBar({ value, accessibilityLabel }: { value: number; accessibilityLabel: string }) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={styles.track}
    >
      <View style={[styles.fill, { width: `${clamped * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 6,
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: theme.surfaceRaised,
  },
  fill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: theme.accent,
  },
});
