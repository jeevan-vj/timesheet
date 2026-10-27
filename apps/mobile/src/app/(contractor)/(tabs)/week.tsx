import {
  formatDayHeading,
  formatMinutes,
  formatWeekRange,
  portalCalendar,
  shiftWeek,
  sumPaidMinutes,
  weekEnd,
  type PortalShift,
} from "@cleantrack/core";
import { useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenScroll } from "@/components/screen-scroll";
import { ShiftList } from "@/components/shift-list";
import { ShiftSheet } from "@/components/shift-sheet";
import { usePortalWeek } from "@/portal-client";
import { theme } from "@/theme";

export { ErrorBoundary } from "@/components/route-error-boundary";

export default function WeekScreen() {
  const [weekStart, setWeekStart] = useState(() => portalCalendar().weekStart);
  const [shift, setShift] = useState<PortalShift | null>(null);
  const week = usePortalWeek(weekStart);
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx > 48) setWeekStart((current) => shiftWeek(current, -1));
        else if (gesture.dx < -48) setWeekStart((current) => shiftWeek(current, 1));
      },
    }),
  ).current;
  const end = weekEnd(weekStart);
  const shifts = week.data?.days.flatMap((day) => day.shifts) ?? [];

  return (
    <>
      <ScreenScroll
        onRefresh={() => {
          void week.refetch();
        }}
        refreshing={week.isRefetching}
        testID="contractor-week"
        title="My week"
        updatedAt={week.dataUpdatedAt > 0 ? week.dataUpdatedAt : null}
      >
        <View {...pan.panHandlers} style={styles.picker}>
          <Pressable
            accessibilityLabel="Previous week"
            accessibilityRole="button"
            onPress={() => setWeekStart((current) => shiftWeek(current, -1))}
            style={styles.step}
          >
            <Text style={styles.stepText}>Previous</Text>
          </Pressable>
          <Text accessibilityLiveRegion="polite" style={styles.range}>
            {formatWeekRange(weekStart, end)}
          </Text>
          <Pressable
            accessibilityLabel="Next week"
            accessibilityRole="button"
            onPress={() => setWeekStart((current) => shiftWeek(current, 1))}
            style={styles.step}
          >
            <Text style={styles.stepText}>Next</Text>
          </Pressable>
        </View>
        <Text style={styles.hours}>{week.data ? formatMinutes(sumPaidMinutes(shifts)) : "Loading hours"}</Text>
        {week.isError ? (
          <Text accessibilityRole="alert" style={styles.body}>
            Could not load this week.
          </Text>
        ) : null}
        {week.data?.days.map((day) => (
          <View key={day.date}>
            <Text style={styles.day}>{formatDayHeading(day.date)}</Text>
            <ShiftList onPress={setShift} shifts={day.shifts} />
          </View>
        ))}
      </ScreenScroll>
      <ShiftSheet onClose={() => setShift(null)} shift={shift} />
    </>
  );
}

const styles = StyleSheet.create({
  picker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  step: {
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    justifyContent: "center",
  },
  stepText: {
    color: theme.accent,
    fontSize: 16,
    fontWeight: "700",
  },
  range: {
    flex: 1,
    color: theme.text,
    fontSize: 18,
    fontWeight: "700",
    flexShrink: 1,
  },
  hours: {
    color: theme.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  day: {
    color: theme.text,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 24,
  },
  body: {
    color: theme.text,
    fontSize: 16,
    lineHeight: 24,
  },
});
