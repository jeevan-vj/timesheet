import {
  formatDayHeading,
  formatMinutes,
  formatWeekRange,
  portalCalendar,
  shiftWeek,
  showsBusinessName,
  sumPaidMinutes,
  weekEnd,
  type PortalShift,
} from "@cleantrack/core";
import { SymbolView } from "expo-symbols";
import { useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { ShiftList } from "@/components/shift-list";
import { ShiftSheet } from "@/components/shift-sheet";
import {
  collapseEmptyDays,
  emptySpanLabel,
  isCurrentWeek,
  weekDayProgress,
  weekIncludesDate,
} from "@/contractor-view";
import { usePortalWeek } from "@/portal-client";
import {
  Card,
  EmptyState,
  ErrorState,
  ProgressBar,
  Screen,
  SecondaryButton,
  SectionHeader,
  Skeleton,
  spacing,
  theme,
  typeScale,
} from "@/ui";

export { ErrorBoundary } from "@/components/route-error-boundary";

function RefreshNote() {
  return (
    <Text accessibilityRole="alert" style={styles.refreshError}>
      Could not refresh. Showing the latest saved week.
    </Text>
  );
}

function WeekSkeleton() {
  return (
    <View accessibilityLabel="Loading week" style={styles.skeletons}>
      <Skeleton height={112} />
      <Skeleton height={72} />
      <Skeleton height={72} />
      <Skeleton height={72} />
    </View>
  );
}

export default function WeekScreen() {
  const calendar = portalCalendar();
  const [weekStart, setWeekStart] = useState(calendar.weekStart);
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
  const onThisWeek = isCurrentWeek(weekStart, calendar.today);
  const shifts = week.data?.days.flatMap((day) => day.shifts) ?? [];
  const showBusiness = showsBusinessName(shifts);
  const progress = weekDayProgress(weekStart, calendar.today);
  const rows = week.data ? collapseEmptyDays(week.data.days, calendar.today) : [];
  const loading = !week.data && week.isPending;
  const initialError = !week.data && week.isError;
  const refreshError = Boolean(week.data && week.isError);
  const refetch = () => {
    void week.refetch();
  };

  return (
    <>
      <Screen
        onRefresh={refetch}
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
            <SymbolView name={{ ios: "chevron.left", android: "chevron_left", web: "chevron_left" }} size={22} tintColor={theme.accent} />
          </Pressable>
          <View style={styles.rangeBlock}>
            <Text accessibilityLiveRegion="polite" style={styles.range}>
              {formatWeekRange(weekStart, end)}
            </Text>
            {onThisWeek ? <Text style={styles.thisWeek}>This week</Text> : null}
          </View>
          <Pressable
            accessibilityLabel="Next week"
            accessibilityRole="button"
            onPress={() => setWeekStart((current) => shiftWeek(current, 1))}
            style={styles.step}
          >
            <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={22} tintColor={theme.accent} />
          </Pressable>
        </View>
        {onThisWeek ? null : (
          <SecondaryButton accessibilityLabel="Jump to this week" onPress={() => setWeekStart(calendar.weekStart)}>
            This week
          </SecondaryButton>
        )}
        {loading && !initialError ? <WeekSkeleton /> : null}
        {initialError ? <ErrorState message="This week is unavailable." onRetry={refetch} /> : null}
        {week.data ? (
          <>
            {refreshError ? <RefreshNote /> : null}
            <Card>
              <Text style={styles.hoursLabel}>Hours</Text>
              <Text style={styles.hours}>{formatMinutes(sumPaidMinutes(shifts))}</Text>
              <ProgressBar accessibilityLabel={progress.label} value={progress.value} />
              <Text style={styles.progress}>{progress.label}</Text>
            </Card>
            {shifts.length === 0 ? (
              <EmptyState
                detail={
                  weekIncludesDate(weekStart, calendar.today)
                    ? "Nothing is scheduled, including today."
                    : "Nothing is scheduled for these seven days."
                }
                icon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }}
                title="No shifts this week"
              />
            ) : (
              rows.map((row) => {
                if (row.kind === "empty") {
                  return (
                    <View key={`${row.from}:${row.to}`} style={styles.gap}>
                      <Text style={styles.gapText}>{emptySpanLabel(row.from, row.to)}</Text>
                    </View>
                  );
                }
                const day = row.day;
                return (
                  <View key={day.date} style={row.isToday ? styles.today : styles.day}>
                    <View style={styles.dayHeading}>
                      <SectionHeader>{formatDayHeading(day.date)}</SectionHeader>
                      {row.isToday ? <Text style={styles.todayLabel}>Today</Text> : null}
                    </View>
                    {day.shifts.length === 0 ? <Text style={styles.gapText}>No shifts</Text> : (
                      <ShiftList onPress={setShift} shifts={day.shifts} showBusiness={showBusiness} />
                    )}
                  </View>
                );
              })
            )}
          </>
        ) : null}
      </Screen>
      <ShiftSheet onClose={() => setShift(null)} shift={shift} />
    </>
  );
}

const styles = StyleSheet.create({
  picker: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  step: {
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  rangeBlock: {
    flex: 1,
    gap: spacing.xxs,
  },
  range: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 24,
    fontWeight: "700",
    flexShrink: 1,
  },
  thisWeek: {
    color: theme.accent,
    fontSize: typeScale.caption,
    lineHeight: 18,
    fontWeight: "700",
  },
  hoursLabel: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.caption,
    lineHeight: 18,
    fontWeight: "700",
  },
  hours: {
    color: theme.text,
    fontSize: typeScale.title,
    lineHeight: 28,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  progress: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.caption,
    lineHeight: 18,
  },
  refreshError: {
    color: theme.mutedHighContrast,
    backgroundColor: theme.surfaceRaised,
    borderRadius: theme.radius,
    borderCurve: "continuous",
    padding: spacing.sm,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
  day: {
    gap: spacing.xs,
  },
  today: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: theme.radius,
    borderCurve: "continuous",
    padding: spacing.sm,
  },
  dayHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  todayLabel: {
    color: theme.accentText,
    backgroundColor: theme.accent,
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    fontSize: typeScale.caption,
    lineHeight: 18,
    fontWeight: "700",
  },
  gap: {
    minHeight: theme.touchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderCurve: "continuous",
  },
  gapText: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
  skeletons: {
    gap: spacing.sm,
  },
});
