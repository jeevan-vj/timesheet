import {
  PORTAL_REMITTANCE_AVAILABLE,
  formatMinutes,
  formatNzd,
  formatWeekRange,
  portalCalendar,
  spokenNzd,
} from "@cleantrack/core";
import * as Linking from "expo-linking";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { payWeekRows } from "@/contractor-view";
import { usePortalPaymentDetail, usePortalPayments } from "@/portal-client";
import { apiBaseUrl } from "@/runtime-config";
import {
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  SectionHeader,
  Sheet,
  Skeleton,
  StatTile,
  StatusPill,
  spacing,
  theme,
  typeScale,
} from "@/ui";

export { ErrorBoundary } from "@/components/route-error-boundary";

function PaySkeleton() {
  return (
    <View accessibilityLabel="Loading pay" style={styles.skeletons}>
      <Skeleton height={112} />
      <Skeleton height={72} />
      <Skeleton height={72} />
    </View>
  );
}

export default function PayScreen() {
  const { weekStart } = portalCalendar();
  const payments = usePortalPayments(weekStart);
  const [selected, setSelected] = useState<string | null>(null);
  const detail = usePortalPaymentDetail(selected);
  const summary = payments.data ? payWeekRows(payments.data) : null;
  const openWeek = summary?.rows.find((week) => week.weekStart === selected && week.status === "Approved") ?? null;
  const loading = !payments.data && payments.isPending;
  const initialError = !payments.data && payments.isError;
  const refreshError = Boolean(payments.data && payments.isError);
  const refetch = () => {
    void payments.refetch();
    if (selected) void detail.refetch();
  };

  return (
    <>
      <Screen
        onRefresh={refetch}
        refreshing={payments.isRefetching || (selected != null && detail.isRefetching)}
        testID="contractor-pay"
        title="Pay"
        updatedAt={null}
      >
        {loading && !initialError ? <PaySkeleton /> : null}
        {initialError ? <ErrorState message="Approved pay is unavailable." onRetry={refetch} /> : null}
        {summary ? (
          <>
            {refreshError ? (
              <Text accessibilityRole="alert" style={styles.refreshError}>
                Could not refresh. Showing the last pay totals from this session.
              </Text>
            ) : null}
            <View style={styles.hero}>
              <StatTile label="Approved" value={formatNzd(summary.approvedCents)}>
                <Text accessibilityLabel={spokenNzd(summary.approvedCents)} style={styles.note}>
                  {formatMinutes(summary.approvedMinutes)} approved
                </Text>
              </StatTile>
            </View>
            {summary.rows.length === 0 ? (
              <EmptyState
                detail="Approved pay will show up here after the business approves a week."
                icon={{ ios: "banknote", android: "payments", web: "payments" }}
                title="No approved weeks yet"
              />
            ) : (
              <View style={styles.list}>
                <SectionHeader>Weeks</SectionHeader>
                {summary.rows.map((week) => {
                  const range = formatWeekRange(week.weekStart, week.weekEnd);
                  const minutes = formatMinutes(week.paidMinutes);
                  const open = week.status === "Approved" ? () => setSelected(week.weekStart) : undefined;
                  return (
                    <ListRow
                      accessibilityLabel={`${range}, ${minutes}, ${spokenNzd(week.payCents)}, ${week.status}`}
                      icon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }}
                      key={`${week.status}:${week.weekStart}`}
                      onPress={open}
                      subtitle={`${minutes} · ${formatNzd(week.payCents)}`}
                      title={range}
                      trailing={<StatusPill label={week.status} />}
                    />
                  );
                })}
              </View>
            )}
            <View style={styles.list}>
              <SectionHeader>Remittance</SectionHeader>
              {PORTAL_REMITTANCE_AVAILABLE ? (
                <ListRow
                  accessibilityLabel="View remittance on the web"
                  icon={{ ios: "doc.text", android: "description", web: "description" }}
                  onPress={() => {
                    void Linking.openURL(`${apiBaseUrl()}/portal`);
                  }}
                  subtitle="Remittance PDFs stay on the website"
                  title="View on web"
                />
              ) : (
                <Text style={styles.note}>Remittance PDFs stay on the website.</Text>
              )}
            </View>
          </>
        ) : null}
      </Screen>
      <Sheet
        closeLabel="Close week detail"
        onClose={() => setSelected(null)}
        title={openWeek ? formatWeekRange(openWeek.weekStart, openWeek.weekEnd) : "Week"}
        visible={openWeek != null}
      >
        {detail.isPending && !detail.data ? (
          <View accessibilityLabel="Loading week detail" style={styles.skeletons}>
            <Skeleton height={112} />
            <Skeleton height={72} />
          </View>
        ) : null}
        {detail.isError ? <ErrorState message="This week's pay is unavailable." onRetry={() => void detail.refetch()} /> : null}
        {detail.data ? (
          <>
            <StatTile label="Approved" value={formatNzd(detail.data.payCents)}>
              <Text accessibilityLabel={spokenNzd(detail.data.payCents)} style={styles.note}>
                {formatMinutes(detail.data.paidMinutes)}
              </Text>
            </StatTile>
            {detail.data.lines.length === 0 ? (
              <EmptyState
                detail="This approved week has no paid lines."
                icon={{ ios: "banknote", android: "payments", web: "payments" }}
                title="No paid shifts"
              />
            ) : (
              detail.data.lines.map((line) => (
                <ListRow
                  accessibilityLabel={`${line.siteName}, ${line.businessName}, ${formatMinutes(line.paidMinutes)}, ${spokenNzd(line.payCents)}`}
                  icon={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }}
                  key={line.id}
                  subtitle={`${line.businessName} · ${formatMinutes(line.paidMinutes)}`}
                  title={line.siteName}
                  trailing={<Text style={styles.amount}>{formatNzd(line.payCents)}</Text>}
                />
              ))
            )}
          </>
        ) : null}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: "row",
  },
  list: {
    gap: spacing.xs,
  },
  note: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
  amount: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 22,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
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
