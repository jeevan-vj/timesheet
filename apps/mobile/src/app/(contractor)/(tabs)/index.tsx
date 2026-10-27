import {
  aucklandDateIso,
  directionsUrl,
  formatDayHeading,
  formatMinutes,
  formatNzd,
  formatShiftTime,
  selectNextJob,
  spokenNzd,
  sumPaidMinutes,
  weekStartFromDate,
  type DirectionsPlatform,
  type PortalShift,
} from "@cleantrack/core";
import * as Linking from "expo-linking";
import { router, type Href } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenScroll } from "@/components/screen-scroll";
import { ShiftSheet } from "@/components/shift-sheet";
import { usePortalPayments, usePortalUpcoming, usePortalWeek } from "@/portal-client";
import { theme } from "@/theme";

function mapsPlatform(): DirectionsPlatform {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web";
}

function latestUpdate(...times: number[]): number | null {
  const valid = times.filter((time) => time > 0);
  return valid.length === 0 ? null : Math.max(...valid);
}

export default function HomeScreen() {
  const today = aucklandDateIso(new Date());
  const weekStart = weekStartFromDate(today);
  const week = usePortalWeek(weekStart);
  const upcoming = usePortalUpcoming();
  const pay = usePortalPayments(weekStart);
  const [shift, setShift] = useState<PortalShift | null>(null);
  const shifts = upcoming.data?.days.flatMap((day) => day.shifts) ?? [];
  const next = upcoming.data ? selectNextJob(shifts, today) : null;
  const weekShifts = week.data?.days.flatMap((day) => day.shifts) ?? [];
  const refreshing = week.isRefetching || upcoming.isRefetching || pay.isRefetching;

  return (
    <>
      <ScreenScroll
        onRefresh={() => {
          void week.refetch();
          void upcoming.refetch();
          void pay.refetch();
        }}
        refreshing={refreshing}
        testID="contractor-home"
        title="Home"
        updatedAt={latestUpdate(week.dataUpdatedAt, upcoming.dataUpdatedAt)}
      >
        <Text style={styles.section}>This week</Text>
        <Text style={styles.hours}>{week.data ? `${formatMinutes(sumPaidMinutes(weekShifts))} this week` : "Loading hours"}</Text>
        {pay.data ? (
          <Text accessibilityLabel={spokenNzd(pay.data.headline.payCents)} maxFontSizeMultiplier={1.6} style={styles.headline}>
            {formatNzd(pay.data.headline.payCents)}
          </Text>
        ) : (
          <Text style={styles.body}>{pay.isPending ? "Loading pay" : "Pay loads when you're back online."}</Text>
        )}
        {pay.data?.headline.estimated ? <Text style={styles.body}>Estimated, until the week is approved.</Text> : null}

        <Text style={styles.section}>Next job</Text>
        {upcoming.isPending && !upcoming.data ? <Text accessibilityLabel="Loading">Loading your jobs.</Text> : null}
        {upcoming.isError ? (
          <Text accessibilityRole="alert" style={styles.body}>
            Could not load your jobs.
          </Text>
        ) : null}
        {next ? (
          <View style={styles.card}>
            <Pressable
              accessibilityLabel={`${next.siteName}, ${formatDayHeading(next.workDate)}, ${formatShiftTime(next)}`}
              accessibilityRole="button"
              onPress={() => setShift(next)}
            >
              <Text style={styles.cardTitle}>{next.siteName}</Text>
              <Text style={styles.body}>{formatDayHeading(next.workDate)}</Text>
              <Text style={styles.body}>{formatShiftTime(next)}</Text>
              {next.address ? <Text style={styles.body}>{next.address}</Text> : null}
            </Pressable>
            {directionsUrl(next.address, mapsPlatform()) ? (
              <Pressable
                accessibilityLabel={`Directions to ${next.siteName}`}
                accessibilityRole="link"
                onPress={() => {
                  const url = directionsUrl(next.address, mapsPlatform());
                  if (url) void Linking.openURL(url);
                }}
                style={styles.link}
              >
                <Text style={styles.linkText}>Directions</Text>
              </Pressable>
            ) : null}
          </View>
        ) : upcoming.data ? (
          <Text style={styles.body}>No upcoming job.</Text>
        ) : null}

        {week.data && week.data.tasks.length > 0 ? (
          <View accessibilityLabel="Tasks" style={styles.card}>
            <Text style={styles.cardTitle}>Tasks</Text>
            {week.data.tasks.map((task) => (
              <View key={task.id}>
                <Text style={styles.body}>{task.title}</Text>
                <Text style={styles.muted}>{task.detail}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Pressable
          accessibilityLabel="Next 14 days"
          accessibilityRole="button"
          onPress={() => router.push("/upcoming" as Href)}
          style={styles.link}
        >
          <Text style={styles.linkText}>Next 14 days</Text>
        </Pressable>
      </ScreenScroll>
      <ShiftSheet onClose={() => setShift(null)} shift={shift} />
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    color: theme.muted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  hours: {
    color: theme.text,
    fontSize: 16,
    lineHeight: 24,
    flexShrink: 1,
  },
  headline: {
    color: theme.text,
    fontSize: 40,
    fontWeight: "700",
    flexShrink: 1,
  },
  body: {
    color: theme.text,
    fontSize: 16,
    lineHeight: 24,
    flexShrink: 1,
  },
  muted: {
    color: theme.muted,
    fontSize: 16,
    lineHeight: 24,
    flexShrink: 1,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    padding: 16,
    gap: 4,
  },
  cardTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: "700",
    flexShrink: 1,
  },
  link: {
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    justifyContent: "center",
  },
  linkText: {
    color: theme.accent,
    fontSize: 16,
    fontWeight: "700",
  },
});
