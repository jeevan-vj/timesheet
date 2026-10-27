import {
  formatDayHeading,
  type PortalShift,
} from "@cleantrack/core";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenScroll } from "@/components/screen-scroll";
import { ShiftList } from "@/components/shift-list";
import { ShiftSheet } from "@/components/shift-sheet";
import { usePortalUpcoming } from "@/portal-client";
import { theme } from "@/theme";

export { ErrorBoundary } from "@/components/route-error-boundary";

export default function UpcomingScreen() {
  const upcoming = usePortalUpcoming();
  const [shift, setShift] = useState<PortalShift | null>(null);
  const range = upcoming.data ? `${formatDayHeading(upcoming.data.from)} – ${formatDayHeading(upcoming.data.to)}` : "The next 14 days";

  return (
    <>
      <ScreenScroll
        onRefresh={() => {
          void upcoming.refetch();
        }}
        refreshing={upcoming.isRefetching}
        testID="contractor-upcoming"
        title="Upcoming"
        updatedAt={upcoming.dataUpdatedAt > 0 ? upcoming.dataUpdatedAt : null}
      >
        <Pressable accessibilityLabel="Back" accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.range}>{range}</Text>
        {upcoming.isPending && !upcoming.data ? <Text accessibilityLabel="Loading">Loading the next 14 days.</Text> : null}
        {upcoming.isError ? (
          <Text accessibilityRole="alert" style={styles.body}>
            Could not load upcoming work.
          </Text>
        ) : null}
        {upcoming.data && upcoming.data.days.length === 0 ? <Text style={styles.body}>Nothing scheduled in the next 14 days.</Text> : null}
        {upcoming.data?.days.map((day) => (
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
  back: {
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  backText: {
    color: theme.accent,
    fontSize: 16,
    fontWeight: "700",
  },
  range: {
    color: theme.muted,
    fontSize: 16,
    lineHeight: 24,
    flexShrink: 1,
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
    flexShrink: 1,
  },
});
