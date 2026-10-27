import {
  aucklandDateIso,
  formatMinutes,
  formatNzd,
  formatWeekRange,
  spokenNzd,
  weekStartFromDate,
} from "@cleantrack/core";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenScroll } from "@/components/screen-scroll";
import { usePortalPaymentDetail, usePortalPayments } from "@/portal-client";
import { theme } from "@/theme";

export default function PayScreen() {
  const weekStart = weekStartFromDate(aucklandDateIso(new Date()));
  const payments = usePortalPayments(weekStart);
  const [selected, setSelected] = useState<string | null>(null);
  const detail = usePortalPaymentDetail(selected);
  const weeks = payments.data?.weeks ?? [];
  const totalCents = weeks.reduce((sum, week) => sum + week.payCents, 0);
  const totalMinutes = weeks.reduce((sum, week) => sum + week.paidMinutes, 0);

  return (
    <ScreenScroll
      onRefresh={() => {
        void payments.refetch();
        if (selected) void detail.refetch();
      }}
      refreshing={payments.isRefetching || detail.isRefetching}
      testID="contractor-pay"
      title="Pay"
      updatedAt={null}
    >
      <Text style={styles.label}>Approved</Text>
      {payments.data ? (
        <Text accessibilityLabel={spokenNzd(totalCents)} maxFontSizeMultiplier={1.6} style={styles.headline}>
          {formatNzd(totalCents)}
        </Text>
      ) : (
        <Text style={styles.body}>{payments.isPending ? "Loading pay" : "Pay loads when you're back online."}</Text>
      )}
      {payments.data ? <Text style={styles.body}>{formatMinutes(totalMinutes)} approved</Text> : null}
      {payments.isError ? (
        <Text accessibilityRole="alert" style={styles.body}>
          Could not load approved weeks.
        </Text>
      ) : null}
      {payments.data && weeks.length === 0 ? <Text style={styles.body}>No approved weeks yet.</Text> : null}
      {weeks.map((week) => (
        <Pressable
          accessibilityLabel={`${formatWeekRange(week.weekStart, week.weekEnd)}, ${formatMinutes(week.paidMinutes)}, ${spokenNzd(week.payCents)}`}
          accessibilityRole="button"
          key={week.weekStart}
          onPress={() => setSelected(week.weekStart)}
          style={styles.row}
        >
          <Text style={styles.rowTitle}>{formatWeekRange(week.weekStart, week.weekEnd)}</Text>
          <Text style={styles.body}>{formatMinutes(week.paidMinutes)}</Text>
          <Text accessibilityLabel={spokenNzd(week.payCents)} style={styles.amount}>
            {formatNzd(week.payCents)}
          </Text>
        </Pressable>
      ))}
      {selected ? (
        <View accessibilityViewIsModal style={styles.detail}>
          <Text accessibilityRole="header" style={styles.rowTitle}>
            Week detail
          </Text>
          {detail.isPending ? <Text accessibilityLabel="Loading">Loading this week.</Text> : null}
          {detail.isError ? (
            <Text accessibilityRole="alert" style={styles.body}>
              Could not load this week.
            </Text>
          ) : null}
          {detail.data ? (
            <>
              <Text accessibilityLabel={spokenNzd(detail.data.payCents)} maxFontSizeMultiplier={1.6} style={styles.headline}>
                {formatNzd(detail.data.payCents)}
              </Text>
              <Text style={styles.body}>{formatMinutes(detail.data.paidMinutes)}</Text>
              {detail.data.lines.map((line) => (
                <View key={line.id} style={styles.line}>
                  <Text style={styles.body}>{line.siteName}</Text>
                  <Text style={styles.muted}>{line.businessName}</Text>
                  <Text style={styles.body}>{formatMinutes(line.paidMinutes)}</Text>
                  <Text accessibilityLabel={spokenNzd(line.payCents)} style={styles.amount}>
                    {formatNzd(line.payCents)}
                  </Text>
                </View>
              ))}
            </>
          ) : null}
          <Pressable accessibilityLabel="Close week detail" accessibilityRole="button" onPress={() => setSelected(null)} style={styles.close}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  label: {
    color: theme.muted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
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
  row: {
    minHeight: theme.touchTarget,
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    padding: 16,
    gap: 4,
  },
  rowTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: "700",
    flexShrink: 1,
  },
  amount: {
    color: theme.text,
    fontSize: 20,
    fontWeight: "700",
    flexShrink: 1,
  },
  detail: {
    backgroundColor: theme.surfaceRaised,
    borderRadius: theme.radius,
    padding: 16,
    gap: 8,
  },
  line: {
    gap: 2,
    paddingVertical: 8,
  },
  close: {
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    justifyContent: "center",
  },
  closeText: {
    color: theme.accent,
    fontSize: 16,
    fontWeight: "700",
  },
});
