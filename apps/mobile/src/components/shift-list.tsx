import {
  formatShiftTime,
  shiftStatusLabel,
  showsBusinessName,
  type PortalShift,
} from "@cleantrack/core/portal";
import { StyleSheet, View } from "react-native";
import { ListRow, StatusPill, spacing } from "@/ui";

export function ShiftList({
  shifts,
  onPress,
  showBusiness,
}: {
  shifts: readonly PortalShift[];
  onPress: (shift: PortalShift) => void;
  showBusiness?: boolean;
}) {
  if (shifts.length === 0) return null;
  const show = showBusiness ?? showsBusinessName(shifts);
  return (
    <View style={styles.list}>
      {shifts.map((shift) => {
        const when = formatShiftTime(shift);
        const status = shiftStatusLabel(shift.occurrenceKind);
        const subtitle = [when, show ? shift.businessName : ""].filter(Boolean).join(" · ");
        return (
          <ListRow
            accessibilityLabel={[shift.siteName, subtitle, status].filter(Boolean).join(", ")}
            icon={{ ios: "clock", android: "schedule", web: "schedule" }}
            key={shift.id}
            onPress={() => onPress(shift)}
            subtitle={subtitle}
            title={shift.siteName}
            trailing={<StatusPill label={status} />}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.xs,
  },
});
