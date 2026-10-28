import { formatDayHeading, type PortalShift } from "@cleantrack/core";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ShiftList } from "@/components/shift-list";
import { ShiftSheet } from "@/components/shift-sheet";
import { usePortalUpcoming } from "@/portal-client";
import {
  EmptyState,
  ErrorState,
  Screen,
  SectionHeader,
  Skeleton,
  spacing,
  theme,
  typeScale,
} from "@/ui";

export { ErrorBoundary } from "@/components/route-error-boundary";

function UpcomingSkeleton() {
  return (
    <View accessibilityLabel="Loading upcoming" style={styles.skeletons}>
      <Skeleton height={28} />
      <Skeleton height={72} />
      <Skeleton height={28} />
      <Skeleton height={72} />
    </View>
  );
}

export default function UpcomingScreen() {
  const upcoming = usePortalUpcoming();
  const [shift, setShift] = useState<PortalShift | null>(null);
  const loading = !upcoming.data && upcoming.isPending;
  const initialError = !upcoming.data && upcoming.isError;
  const refreshError = Boolean(upcoming.data && upcoming.isError);
  const range = upcoming.data
    ? `${formatDayHeading(upcoming.data.from)} – ${formatDayHeading(upcoming.data.to)}`
    : "Next 14 days";
  const refetch = () => {
    void upcoming.refetch();
  };

  return (
    <>
      <Screen
        onRefresh={refetch}
        refreshing={upcoming.isRefetching}
        testID="contractor-upcoming"
        title={range}
        updatedAt={upcoming.dataUpdatedAt > 0 ? upcoming.dataUpdatedAt : null}
      >
        {loading && !initialError ? <UpcomingSkeleton /> : null}
        {initialError ? <ErrorState message="The next 14 days are unavailable." onRetry={refetch} /> : null}
        {upcoming.data ? (
          <>
            {refreshError ? (
              <Text accessibilityRole="alert" style={styles.refreshError}>
                Could not refresh. Showing the latest saved shifts.
              </Text>
            ) : null}
            {upcoming.data.days.length === 0 ? (
              <EmptyState
                detail="When a shift is scheduled in the next 14 days, it will show up here."
                icon={{ ios: "calendar.badge.clock", android: "calendar_clock", web: "calendar_clock" }}
                title="Nothing scheduled"
              />
            ) : (
              upcoming.data.days.map((day) => (
                <View key={day.date} style={styles.day}>
                  <SectionHeader>{formatDayHeading(day.date)}</SectionHeader>
                  <ShiftList onPress={setShift} shifts={day.shifts} />
                </View>
              ))
            )}
          </>
        ) : null}
      </Screen>
      <ShiftSheet onClose={() => setShift(null)} shift={shift} />
    </>
  );
}

const styles = StyleSheet.create({
  day: {
    gap: spacing.xs,
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
  skeletons: {
    gap: spacing.sm,
  },
});
