import {
  formatMinutes,
  formatNzd,
  ownerApprovalLabel,
  ownerSetupIncomplete,
  ownerWeekTotals,
  portalCalendar,
  spokenNzd,
  type OwnerDashboard,
} from "@cleantrack/core";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Figure, FinishSetup, OwnerGate, ScheduleNote, latestDataUpdatedAt } from "@/components/owner-feedback";
import { OwnerRemittanceSheet } from "@/components/owner-remittance-sheet";
import { OwnerWeekPicker } from "@/components/owner-week-picker";
import { OwnerWeekApproval } from "@/components/owner-week-approval";
import { useOwnerDashboard } from "@/owner-client";
import { EmptyState, ListRow, Screen, StatusPill, spacing, theme, typeScale } from "@/ui";

export { ErrorBoundary } from "@/components/route-error-boundary";

export default function OwnerPayrollScreen() {
  const [weekStart, setWeekStart] = useState(() => portalCalendar().weekStart);
  const [remittance, setRemittance] = useState<{ contractorId: string; contractorName: string } | null>(null);
  const dashboard = useOwnerDashboard(weekStart);

  return (
    <>
      <Screen
        onRefresh={() => {
          void dashboard.refetch();
        }}
        refreshing={dashboard.isRefetching}
        testID="owner-payroll"
        title="Payroll"
        updatedAt={latestDataUpdatedAt(dashboard.dataUpdatedAt)}
      >
        <OwnerWeekPicker onChange={(value) => { setRemittance(null); setWeekStart(value); }} weekStart={weekStart} />
        <OwnerGate query={dashboard}>
          {(data) => ownerSetupIncomplete(data.business) ? <FinishSetup /> : (
            <PayrollBody data={data} onRefresh={() => dashboard.refetch()} onSelectRemittance={setRemittance} />
          )}
        </OwnerGate>
      </Screen>
      <OwnerRemittanceSheet onClose={() => setRemittance(null)} selection={remittance} weekStart={weekStart} />
    </>
  );
}

function PayrollBody({
  data,
  onRefresh,
  onSelectRemittance,
}: {
  data: OwnerDashboard;
  onRefresh: () => Promise<unknown>;
  onSelectRemittance: (selection: { contractorId: string; contractorName: string }) => void;
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
              onPress={() => onSelectRemittance({ contractorId: row.contractorId, contractorName: row.contractorName })}
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
});
