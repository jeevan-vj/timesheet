import {
  formatMinutes,
  formatNzd,
  ownerApprovalLabel,
  ownerSetupIncomplete,
  ownerWeekTotals,
  portalCalendar,
  spokenNzd,
  type OwnerDashboard,
  type OwnerRemittance,
} from "@cleantrack/core";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Figure, FinishSetup, OwnerFailure, OwnerGate, ScheduleNote, latestDataUpdatedAt } from "@/components/owner-feedback";
import { OwnerWeekPicker } from "@/components/owner-week-picker";
import { OwnerWeekApproval } from "@/components/owner-week-approval";
import { useOwnerDashboard, useOwnerRemittance } from "@/owner-client";
import { EmptyState, ListRow, Screen, Sheet, Skeleton, StatusPill, spacing, theme, typeScale } from "@/ui";

export { ErrorBoundary } from "@/components/route-error-boundary";

export default function OwnerPayrollScreen() {
  const [weekStart, setWeekStart] = useState(() => portalCalendar().weekStart);
  const [selectedContractor, setSelectedContractor] = useState<{ id: string; name: string } | null>(null);
  const dashboard = useOwnerDashboard(weekStart);
  const remittance = useOwnerRemittance(selectedContractor?.id ?? null, weekStart);

  return (
    <Screen
      onRefresh={() => {
        void dashboard.refetch();
      }}
      refreshing={dashboard.isRefetching}
      testID="owner-payroll"
      title="Payroll"
      updatedAt={latestDataUpdatedAt(dashboard.dataUpdatedAt)}
    >
      <OwnerWeekPicker onChange={(nextWeek) => {
        setSelectedContractor(null);
        setWeekStart(nextWeek);
      }} weekStart={weekStart} />
      <OwnerGate query={dashboard}>
        {(data) => ownerSetupIncomplete(data.business) ? <FinishSetup /> : (
          <PayrollBody data={data} onRefresh={() => dashboard.refetch()} onSelect={setSelectedContractor} />
        )}
      </OwnerGate>
      <Sheet
        closeLabel="Close remittance"
        onClose={() => setSelectedContractor(null)}
        title={selectedContractor ? `${selectedContractor.name} remittance` : "Remittance"}
        visible={selectedContractor != null}
      >
        <RemittanceBody query={remittance} />
      </Sheet>
    </Screen>
  );
}

function PayrollBody({
  data,
  onRefresh,
  onSelect,
}: {
  data: OwnerDashboard;
  onRefresh: () => Promise<unknown>;
  onSelect: (contractor: { id: string; name: string }) => void;
}) {
  const totals = ownerWeekTotals(data.summary);
  return (
    <>
      <ScheduleNote dashboard={data} />
      <StatusPill label={ownerApprovalLabel(data.approval.status)} />
      <OwnerWeekApproval data={data} onRefresh={onRefresh} />
      <Figure accessibilityLabel={spokenNzd(totals.payCents)} label="Gross pay" value={formatNzd(totals.payCents)} />
      <Text style={styles.caption}>{formatMinutes(totals.paidMinutes)} paid. Gross contractor pay before tax, GST, expenses, or adjustments.</Text>
      {data.summary.length === 0 ? (
        <EmptyState
          detail="Pay appears when shifts are recorded for this week."
          icon={{ ios: "banknote", android: "payments", web: "payments" }}
          title="No contractor pay this week"
        />
      ) : (
        <View style={styles.list}>
          {data.summary.map((row) => (
            <ListRow
              accessibilityLabel={`View remittance for ${row.contractorName}, ${formatMinutes(row.paidMinutes)}, ${spokenNzd(row.payCents)}`}
              icon={{ ios: "person", android: "person", web: "person" }}
              key={row.contractorId}
              onPress={() => onSelect({ id: row.contractorId, name: row.contractorName })}
              subtitle={formatMinutes(row.paidMinutes)}
              title={row.contractorName}
              trailing={<Text accessibilityLabel={spokenNzd(row.payCents)} style={styles.pay}>{formatNzd(row.payCents)}</Text>}
            />
          ))}
        </View>
      )}
    </>
  );
}

type RemittanceQuery = ReturnType<typeof useOwnerRemittance>;

function RemittanceBody({ query }: { query: RemittanceQuery }) {
  if (query.data == null && query.isPending) {
    return (
      <View accessibilityLabel="Loading remittance" style={styles.remittanceStack}>
        <Skeleton height={72} />
        <Skeleton height={96} />
        <Skeleton height={96} />
      </View>
    );
  }
  if (query.data == null && query.isError) {
    return <OwnerFailure error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (query.data == null) return null;
  if (query.data.lines.length === 0) {
    return (
      <EmptyState
        detail="There are no recorded shifts for this contractor and week."
        icon={{ ios: "doc.text", android: "description", web: "description" }}
        title="No remittance available"
      />
    );
  }
  return <RemittanceDetails data={query.data} />;
}

function RemittanceDetails({ data }: { data: OwnerRemittance }) {
  return (
    <View style={styles.remittanceStack}>
      <View style={styles.meta}>
        <Text style={styles.metaLabel}>Week</Text>
        <Text style={styles.metaValue}>{data.weekStart} – {data.weekEnd}</Text>
        <Text style={styles.metaLabel}>Reference</Text>
        <Text selectable style={styles.metaValue}>{data.reference}</Text>
        <Text style={styles.metaLabel}>From</Text>
        <Text style={styles.metaValue}>{data.remitterName} · {data.remitterEmail}</Text>
      </View>
      <View style={styles.list}>
        {data.lines.map((line, index) => (
          <View
            accessibilityLabel={`${line.workDate}, ${line.siteName}, ${formatMinutes(line.paidMinutes)}, rate ${spokenNzd(line.rateCents)}, pay ${spokenNzd(line.payCents)}`}
            key={`${line.workDate}-${line.siteName}-${index}`}
            style={styles.line}
          >
            <View style={styles.lineCopy}>
              <Text style={styles.lineTitle}>{line.siteName}</Text>
              <Text style={styles.caption}>{line.workDate} · {formatMinutes(line.paidMinutes)} · {formatNzd(line.rateCents)}/hr</Text>
            </View>
            <Text accessibilityLabel={spokenNzd(line.payCents)} style={styles.pay}>{formatNzd(line.payCents)}</Text>
          </View>
        ))}
      </View>
      <View accessibilityLabel={`Total, ${formatMinutes(data.paidMinutes)}, ${spokenNzd(data.payCents)}`} style={styles.total}>
        <View>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.caption}>{formatMinutes(data.paidMinutes)}</Text>
        </View>
        <Text style={styles.totalPay}>{formatNzd(data.payCents)}</Text>
      </View>
      <Text style={styles.disclaimer}>{data.disclaimer}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  caption: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
  list: {
    gap: spacing.xs,
  },
  pay: {
    color: theme.text,
    fontSize: typeScale.body,
    fontWeight: "700",
  },
  remittanceStack: {
    gap: spacing.sm,
  },
  meta: {
    gap: spacing.xxs,
    padding: spacing.md,
    borderRadius: theme.radius,
    borderCurve: "continuous",
    backgroundColor: theme.surface,
  },
  metaLabel: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.caption,
    lineHeight: 18,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  metaValue: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 22,
  },
  line: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: theme.radius,
    borderCurve: "continuous",
    backgroundColor: theme.surface,
  },
  lineCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  lineTitle: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 22,
    fontWeight: "600",
  },
  total: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.muted,
  },
  totalLabel: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 22,
    fontWeight: "700",
  },
  totalPay: {
    color: theme.text,
    fontSize: typeScale.title,
    lineHeight: 28,
    fontWeight: "700",
  },
  disclaimer: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.caption,
    lineHeight: 18,
  },
});
