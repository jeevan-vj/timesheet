import {
  OWNER_SCHEDULE_NOTE,
  ownerScheduleNote,
  type OwnerDashboard,
} from "@cleantrack/core";
import * as Linking from "expo-linking";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { OWNER_WEB_DASHBOARD_PATH, ownerReadMessage } from "@/owner-api";
import { apiBaseUrl } from "@/runtime-config";
import { EmptyState, PrimaryButton, Skeleton, spacing, theme, typeScale } from "@/ui";

export function latestDataUpdatedAt(...times: number[]): number | null {
  const valid = times.filter((time) => time > 0);
  return valid.length === 0 ? null : Math.max(...valid);
}

export function openOwnerWebDashboard(): void {
  void Linking.openURL(`${apiBaseUrl()}${OWNER_WEB_DASHBOARD_PATH}`);
}

export function OwnerLoading() {
  return (
    <View accessibilityLabel="Loading" style={styles.stack}>
      <Skeleton height={88} />
      <Skeleton height={72} />
      <Skeleton height={72} />
    </View>
  );
}

export function FinishSetup() {
  return (
    <View testID="owner-finish-setup">
      <EmptyState
        action={(
          <PrimaryButton accessibilityLabel="Open dashboard on web" onPress={openOwnerWebDashboard}>
            Open dashboard on web
          </PrimaryButton>
        )}
        detail="Create the business in the web dashboard. This app only reads it."
        icon={{ ios: "building.2", android: "business", web: "business" }}
        title="Finish setup on web"
      />
    </View>
  );
}

export function OwnerFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const copy = ownerReadMessage(error);
  if (copy.finishOnWeb) return <FinishSetup />;
  return (
    <EmptyState
      action={<PrimaryButton accessibilityLabel="Try again" onPress={onRetry}>Try again</PrimaryButton>}
      detail={copy.detail}
      icon={{ ios: "arrow.clockwise", android: "refresh", web: "refresh" }}
      title={copy.title}
    />
  );
}

export function RefreshWarning({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <Text accessibilityRole="alert" style={styles.warning}>
      Could not refresh. Showing the latest details.
    </Text>
  );
}

type OwnerQuery = {
  data?: unknown;
  error: unknown;
  isError: boolean;
  isPending: boolean;
  refetch: () => Promise<unknown>;
};

export function OwnerGate<T>({ query, children }: { query: OwnerQuery & { data?: T }; children: (data: T) => ReactNode }) {
  if (query.data == null && query.isPending) return <OwnerLoading />;
  if (query.data == null && query.isError) return <OwnerFailure error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data == null) return null;
  return (
    <>
      <RefreshWarning visible={query.isError} />
      {children(query.data)}
    </>
  );
}

export function Figure({ accessibilityLabel, label, value }: { accessibilityLabel?: string; label: string; value: string }) {
  return (
    <View style={styles.figureBlock}>
      <Text style={styles.kicker}>{label}</Text>
      <Text accessibilityLabel={accessibilityLabel ?? value} style={styles.figure}>{value}</Text>
    </View>
  );
}

export function ScheduleNote({ dashboard }: { dashboard: Pick<OwnerDashboard, "weekStart" | "weekEnd" | "approval" | "assignments" | "entries"> }) {
  const note = ownerScheduleNote({
    weekStart: dashboard.weekStart,
    weekEnd: dashboard.weekEnd,
    approvalStatus: dashboard.approval.status,
    assignments: dashboard.assignments,
    entries: dashboard.entries,
  });
  if (note !== OWNER_SCHEDULE_NOTE) return null;
  return (
    <Text style={styles.note} testID="owner-schedule-note">
      {note}
    </Text>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.sm,
  },
  warning: {
    color: theme.mutedHighContrast,
    backgroundColor: theme.surfaceRaised,
    borderRadius: theme.radius,
    borderCurve: "continuous",
    padding: spacing.sm,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
  figureBlock: {
    gap: spacing.xxs,
  },
  kicker: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.caption,
    lineHeight: 18,
    fontWeight: "700",
  },
  figure: {
    color: theme.text,
    fontSize: typeScale.largeTitle,
    lineHeight: 41,
    fontWeight: "700",
    flexShrink: 1,
  },
  note: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
});
