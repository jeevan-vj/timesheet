import {
  formatMinutes,
  formatNzd,
  ownerApprovalLabel,
  ownerEntriesByContractor,
  ownerSetupIncomplete,
  ownerWeekTotals,
  portalCalendar,
  spokenNzd,
  type OwnerDashboard,
  type OwnerEntry,
} from "@cleantrack/core";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { FinishSetup, OwnerGate, ScheduleNote, latestDataUpdatedAt } from "@/components/owner-feedback";
import { OwnerShiftRow } from "@/components/owner-shift-row";
import { OwnerShiftSheet } from "@/components/owner-shift-sheet";
import { OwnerWeekPicker } from "@/components/owner-week-picker";
import { OwnerWeekApproval } from "@/components/owner-week-approval";
import { useOwnerDashboard } from "@/owner-client";
import { EmptyState, Screen, SectionHeader, StatTile, StatusPill, spacing } from "@/ui";

export { ErrorBoundary } from "@/components/route-error-boundary";

export default function OwnerWeekScreen() {
  const [weekStart, setWeekStart] = useState(() => portalCalendar().weekStart);
  const dashboard = useOwnerDashboard(weekStart);

  return (
    <Screen
      onRefresh={() => {
        void dashboard.refetch();
      }}
      refreshing={dashboard.isRefetching}
      testID="owner-week"
      title="Week"
      updatedAt={latestDataUpdatedAt(dashboard.dataUpdatedAt)}
    >
      <OwnerWeekPicker onChange={setWeekStart} weekStart={weekStart} />
      <OwnerGate query={dashboard}>
        {(data) => ownerSetupIncomplete(data.business) ? <FinishSetup /> : (
          <WeekBody data={data} onRefresh={() => dashboard.refetch()} />
        )}
      </OwnerGate>
    </Screen>
  );
}

function WeekBody({ data, onRefresh }: { data: OwnerDashboard; onRefresh: () => Promise<unknown> }) {
  const [selectedEntry, setSelectedEntry] = useState<OwnerEntry | null>(null);
  const totals = ownerWeekTotals(data.summary);
  const groups = ownerEntriesByContractor(data.entries);
  return (
    <>
      <ScheduleNote dashboard={data} />
      <StatusPill label={ownerApprovalLabel(data.approval.status)} />
      <OwnerWeekApproval data={data} onRefresh={onRefresh} />
      <View style={styles.stats}>
        <StatTile label="Paid hours" value={formatMinutes(totals.paidMinutes)} />
        <StatTile accessibilityLabel={spokenNzd(totals.payCents)} label="Gross pay" value={formatNzd(totals.payCents)} />
      </View>
      {groups.length === 0 ? (
        <EmptyState
          detail="Recorded shifts for this week show up here."
          icon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }}
          title="No shifts this week"
        />
      ) : groups.map((group) => (
        <View key={group.contractorId} style={styles.group}>
          <SectionHeader>{group.contractorName}</SectionHeader>
          {group.entries.map((entry) => (
            <OwnerShiftRow
              entry={entry}
              key={entry.id}
              onPress={() => setSelectedEntry(entry)}
              showContractor={false}
            />
          ))}
        </View>
      ))}
      <OwnerShiftSheet
        approvalStatus={data.approval.status}
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  group: {
    gap: spacing.xs,
  },
});
