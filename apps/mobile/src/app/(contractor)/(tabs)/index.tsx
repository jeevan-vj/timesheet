import {
  directionsUrl,
  formatDayHeading,
  formatMinutes,
  formatNzd,
  formatShiftTime,
  portalCalendar,
  selectNextJob,
  shiftStatusLabel,
  spokenNzd,
  sumPaidMinutes,
  type DirectionsPlatform,
  type PortalShift,
} from "@cleantrack/core";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { ShiftSheet } from "@/components/shift-sheet";
import { usePortalPayments, usePortalUpcoming, usePortalWeek } from "@/portal-client";
import {
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  PrimaryButton,
  Screen,
  SectionHeader,
  Skeleton,
  StatTile,
  StatusPill,
  spacing,
  theme,
  typeScale,
} from "@/ui";

function mapsPlatform(): DirectionsPlatform {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web";
}

function latestUpdate(...times: number[]): number | null {
  const valid = times.filter((time) => time > 0);
  return valid.length === 0 ? null : Math.max(...valid);
}

export { ErrorBoundary } from "@/components/route-error-boundary";

export default function HomeScreen() {
  const { today, weekStart } = portalCalendar();
  const week = usePortalWeek(weekStart);
  const upcoming = usePortalUpcoming();
  const pay = usePortalPayments(weekStart);
  const [shift, setShift] = useState<PortalShift | null>(null);
  const shifts = upcoming.data?.days.flatMap((day) => day.shifts) ?? [];
  const next = upcoming.data ? selectNextJob(shifts, today) : null;
  const weekShifts = week.data?.days.flatMap((day) => day.shifts) ?? [];
  const refreshing = week.isRefetching || upcoming.isRefetching || pay.isRefetching;
  const loading = (!week.data && week.isPending) || (!upcoming.data && upcoming.isPending) || (!pay.data && pay.isPending);
  const initialError = (!week.data && week.isError) || (!upcoming.data && upcoming.isError) || (!pay.data && pay.isError);
  const refreshError = Boolean(week.data && week.isError) || Boolean(upcoming.data && upcoming.isError) || Boolean(pay.data && pay.isError);
  const businessName = next?.businessName ?? weekShifts[0]?.businessName ?? shifts[0]?.businessName;

  const refetchAll = () => {
    void week.refetch();
    void upcoming.refetch();
    void pay.refetch();
  };

  return (
    <>
      <Screen
        onRefresh={refetchAll}
        refreshing={refreshing}
        testID="contractor-home"
        title={businessName ? `Kia ora · ${businessName}` : "Kia ora"}
        updatedAt={latestUpdate(week.dataUpdatedAt, upcoming.dataUpdatedAt)}
      >
        {loading && !initialError ? <HomeSkeleton /> : null}
        {initialError ? <ErrorState message="Your schedule and pay are unavailable." onRetry={refetchAll} /> : null}
        {!loading && !initialError ? (
          <>
            {refreshError ? (
              <Text accessibilityRole="alert" style={styles.refreshError}>
                Some information could not refresh. Showing the latest saved details.
              </Text>
            ) : null}

            <SectionHeader>Next job</SectionHeader>
            {next ? <NextJobCard onOpen={() => setShift(next)} shift={next} /> : (
              <EmptyState
                detail="When your next shift is scheduled, its site, time and directions will appear here."
                icon={{ ios: "calendar.badge.clock", android: "calendar_clock", web: "calendar_clock" }}
                title="Nothing scheduled yet"
              />
            )}

            <View style={styles.stats}>
              <StatTile label="This week" value={formatMinutes(sumPaidMinutes(weekShifts))} />
              <StatTile label="Pay" value={pay.data ? formatNzd(pay.data.headline.payCents) : "—"}>
                {pay.data?.headline.estimated ? <StatusPill label="Estimated" /> : null}
              </StatTile>
            </View>
            {pay.data ? (
              <Text accessibilityLabel={spokenNzd(pay.data.headline.payCents)} style={styles.payContext}>
                {pay.data.headline.estimated ? "Updates until your week is approved." : "Approved pay for this week."}
              </Text>
            ) : null}

            {week.data && week.data.tasks.length > 0 ? (
              <View style={styles.sectionGroup}>
                <SectionHeader>Tasks</SectionHeader>
                {week.data.tasks.map((task) => (
                  <ListRow
                    icon={{ ios: "checklist", android: "checklist", web: "checklist" }}
                    key={task.id}
                    subtitle={task.detail}
                    title={task.title}
                  />
                ))}
              </View>
            ) : null}

            <View style={styles.sectionGroup}>
              <SectionHeader>Plan ahead</SectionHeader>
              <ListRow
                accessibilityLabel="Open shifts for the next 14 days"
                icon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }}
                onPress={() => router.push("/upcoming")}
                subtitle="See every scheduled shift"
                title="Next 14 days"
              />
            </View>
          </>
        ) : null}
      </Screen>
      <ShiftSheet onClose={() => setShift(null)} shift={shift} />
    </>
  );
}

function NextJobCard({ shift, onOpen }: { shift: PortalShift; onOpen: () => void }) {
  const directions = directionsUrl(shift.address, mapsPlatform());
  const status = shiftStatusLabel(shift.occurrenceKind);
  return (
    <Card style={styles.hero}>
      <Pressable
        accessibilityLabel={`${shift.siteName}, ${formatDayHeading(shift.workDate)}, ${formatShiftTime(shift)}, ${status}`}
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [styles.heroContent, pressed && styles.heroPressed]}
      >
        <View style={styles.heroHeading}>
          <Text style={styles.site}>{shift.siteName}</Text>
          <StatusPill label={status} />
        </View>
        <Text style={styles.when}>{formatDayHeading(shift.workDate)} · {formatShiftTime(shift)}</Text>
        {shift.address ? <Text selectable style={styles.address}>{shift.address}</Text> : null}
      </Pressable>
      {directions ? (
        <PrimaryButton
          accessibilityLabel={`Directions to ${shift.siteName}`}
          onPress={() => void Linking.openURL(directions)}
        >
          Directions
        </PrimaryButton>
      ) : null}
    </Card>
  );
}

function HomeSkeleton() {
  return (
    <View accessibilityLabel="Loading home" style={styles.skeletons}>
      <Skeleton height={174} />
      <View style={styles.stats}>
        <Skeleton height={112} style={styles.statSkeleton} />
        <Skeleton height={112} style={styles.statSkeleton} />
      </View>
      <Skeleton height={72} />
    </View>
  );
}

const styles = StyleSheet.create({
  refreshError: {
    color: theme.mutedHighContrast,
    backgroundColor: theme.surfaceRaised,
    borderRadius: theme.radius,
    borderCurve: "continuous",
    padding: spacing.sm,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
  hero: {
    gap: spacing.md,
  },
  heroContent: {
    gap: spacing.xs,
    borderRadius: theme.radius,
    borderCurve: "continuous",
  },
  heroPressed: {
    opacity: 0.72,
  },
  heroHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  site: {
    flex: 1,
    color: theme.text,
    fontSize: typeScale.title,
    lineHeight: 29,
    fontWeight: "700",
  },
  when: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 25,
    fontWeight: "600",
  },
  address: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  payContext: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.caption,
    lineHeight: 18,
  },
  sectionGroup: {
    gap: spacing.xs,
  },
  skeletons: {
    gap: spacing.md,
  },
  statSkeleton: {
    flex: 1,
    minWidth: 132,
  },
});
