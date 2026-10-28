import { formatWeekRange, shiftWeek, weekEnd } from "@cleantrack/core";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { spacing, theme, typeScale } from "@/ui";

export function OwnerWeekPicker({ onChange, weekStart }: { onChange: (weekStart: string) => void; weekStart: string }) {
  return (
    <View style={styles.picker}>
      <Pressable
        accessibilityLabel="Previous week"
        accessibilityRole="button"
        onPress={() => onChange(shiftWeek(weekStart, -1))}
        style={styles.step}
      >
        <Text style={styles.stepText}>Previous</Text>
      </Pressable>
      <Text accessibilityLiveRegion="polite" style={styles.range}>
        {formatWeekRange(weekStart, weekEnd(weekStart))}
      </Text>
      <Pressable
        accessibilityLabel="Next week"
        accessibilityRole="button"
        onPress={() => onChange(shiftWeek(weekStart, 1))}
        style={styles.step}
      >
        <Text style={styles.stepText}>Next</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  picker: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  step: {
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    justifyContent: "center",
  },
  stepText: {
    color: theme.accent,
    fontSize: typeScale.subhead,
    fontWeight: "700",
  },
  range: {
    flex: 1,
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 24,
    fontWeight: "700",
    textAlign: "center",
  },
});
