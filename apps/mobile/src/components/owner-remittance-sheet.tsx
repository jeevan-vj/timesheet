import {
  formatDayHeading,
  formatMinutes,
  formatNzd,
  formatWeekRange,
  spokenNzd,
  type OwnerRemittance,
} from "@cleantrack/core";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { mobileFetch } from "@/api";
import {
  loadOwnerRemittance,
  ownerRemittanceMessage,
  type OwnerRemittanceSend,
} from "@/owner-remittance";
import { EmptyState, ListRow, PrimaryButton, Sheet, Skeleton, spacing, theme, typeScale } from "@/ui";

type Selection = { contractorId: string; contractorName: string };

const sendRemittance: OwnerRemittanceSend = async (path, init) => {
  const response = await mobileFetch(path, init);
  try {
    return { status: response.status, body: await response.json() };
  } catch {
    return { status: response.status, body: null };
  }
};

export function OwnerRemittanceSheet({
  onClose,
  selection,
  weekStart,
}: {
  onClose: () => void;
  selection: Selection | null;
  weekStart: string;
}) {
  const [data, setData] = useState<OwnerRemittance | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    if (!selection) {
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    void loadOwnerRemittance(selection.contractorId, weekStart, sendRemittance)
      .then((value) => {
        if (!active) return;
        setData(value);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason);
        setLoading(false);
      });
    return () => { active = false; };
  }, [attempt, selection, weekStart]);

  const copy = error ? ownerRemittanceMessage(error) : null;
  const title = selection?.contractorName ?? "Remittance";
  return (
    <Sheet closeLabel="Close remittance" onClose={onClose} title={title} visible={selection != null}>
      {loading ? (
        <View accessibilityLabel="Loading remittance" style={styles.stack}>
          <Skeleton height={88} />
          <Skeleton height={72} />
          <Skeleton height={72} />
        </View>
      ) : null}
      {copy ? (
        <EmptyState
          action={<PrimaryButton accessibilityLabel="Try loading remittance again" onPress={retry}>Try again</PrimaryButton>}
          detail={copy.detail}
          icon={{ ios: "arrow.clockwise", android: "refresh", web: "refresh" }}
          title={copy.title}
        />
      ) : null}
      {data ? <RemittanceContent data={data} /> : null}
    </Sheet>
  );
}

function RemittanceContent({ data }: { data: OwnerRemittance }) {
  return (
    <>
      <View style={styles.summary}>
        <Text selectable style={styles.kicker}>Monday–Sunday</Text>
        <Text selectable style={styles.heading}>{formatWeekRange(data.weekStart, data.weekEnd)}</Text>
        <Text selectable style={styles.meta}>Reference {data.reference}</Text>
        <Text selectable style={styles.meta}>From {data.remitterName} · {data.remitterEmail}</Text>
      </View>
      <View style={styles.stack}>
        {data.lines.map((line, index) => (
          <ListRow
            accessibilityLabel={`${line.siteName}, ${formatDayHeading(line.workDate)}, ${formatMinutes(line.paidMinutes)}, rate ${spokenNzd(line.rateCents)} per hour, pay ${spokenNzd(line.payCents)}`}
            icon={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }}
            key={`${line.workDate}:${line.siteName}:${index}`}
            subtitle={`${formatDayHeading(line.workDate)} · ${formatMinutes(line.paidMinutes)} · ${formatNzd(line.rateCents)}/hr`}
            title={line.siteName}
            trailing={<Text selectable style={styles.amount}>{formatNzd(line.payCents)}</Text>}
          />
        ))}
      </View>
      <View accessibilityLabel={`Total ${formatMinutes(data.paidMinutes)}, ${spokenNzd(data.payCents)}`} style={styles.total}>
        <Text selectable style={styles.totalLabel}>Total · {formatMinutes(data.paidMinutes)}</Text>
        <Text selectable style={styles.totalAmount}>{formatNzd(data.payCents)}</Text>
      </View>
      <Text selectable style={styles.disclaimer}>{data.disclaimer}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.xs },
  summary: { gap: spacing.xxs },
  kicker: { color: theme.mutedHighContrast, fontSize: typeScale.caption, lineHeight: 18, fontWeight: "700" },
  heading: { color: theme.text, fontSize: typeScale.title, lineHeight: 28, fontWeight: "700" },
  meta: { color: theme.mutedHighContrast, fontSize: typeScale.subhead, lineHeight: 22 },
  amount: { color: theme.text, fontSize: typeScale.body, fontWeight: "700", fontVariant: ["tabular-nums"] },
  total: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: theme.radius,
    borderCurve: "continuous",
    backgroundColor: theme.surfaceRaised,
  },
  totalLabel: { color: theme.text, fontSize: typeScale.body, lineHeight: 22, fontWeight: "700", flexShrink: 1 },
  totalAmount: { color: theme.accent, fontSize: typeScale.title, lineHeight: 28, fontWeight: "700", fontVariant: ["tabular-nums"] },
  disclaimer: { color: theme.mutedHighContrast, fontSize: typeScale.subhead, lineHeight: 22 },
});
