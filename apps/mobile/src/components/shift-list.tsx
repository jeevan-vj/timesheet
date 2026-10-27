import {
  formatDayHeading,
  formatShiftTime,
  shiftStatusLabel,
  showsBusinessName,
  type PortalShift,
} from "@cleantrack/core/portal";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "@/theme";

export function ShiftList({
  shifts,
  onPress,
}: {
  shifts: readonly PortalShift[];
  onPress: (shift: PortalShift) => void;
}) {
  const showBusiness = showsBusinessName(shifts);
  if (shifts.length === 0) {
    return <Text style={styles.empty}>No shifts</Text>;
  }
  return (
    <View style={styles.list}>
      {shifts.map((shift) => {
        const when = `${formatDayHeading(shift.workDate)}, ${formatShiftTime(shift)}`;
        const status = shiftStatusLabel(shift.occurrenceKind);
        const label = [shift.siteName, when, status, showBusiness ? shift.businessName : ""].filter(Boolean).join(", ");
        return (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="button"
            key={shift.id}
            onPress={() => onPress(shift)}
            style={styles.row}
          >
            <Text style={styles.site}>{shift.siteName}</Text>
            <Text style={styles.meta}>{when}</Text>
            <Text style={styles.badge}>{status}</Text>
            {showBusiness ? <Text style={styles.meta}>{shift.businessName}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
  },
  row: {
    minHeight: theme.touchTarget,
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  site: {
    color: theme.text,
    fontSize: 18,
    fontWeight: "700",
    flexShrink: 1,
  },
  meta: {
    color: theme.muted,
    fontSize: 16,
    lineHeight: 24,
    flexShrink: 1,
  },
  badge: {
    alignSelf: "flex-start",
    color: theme.text,
    backgroundColor: theme.surfaceRaised,
    borderRadius: theme.radius,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  empty: {
    color: theme.muted,
    fontSize: 16,
    lineHeight: 24,
  },
});
