import {
  formatDayHeading,
  formatMinutes,
  ownerEntriesOnDate,
  ownerScheduleNote,
  ownerSetupIncomplete,
  ownerTasks,
  portalCalendar,
  sumPaidMinutes,
  type OwnerDashboard,
} from "@cleantrack/core";
import { StyleSheet, View } from "react-native";
import { Figure, FinishSetup, OwnerGate, ScheduleNote, latestDataUpdatedAt } from "@/components/owner-feedback";
import { OwnerShiftRow } from "@/components/owner-shift-row";
import { useOwnerDashboard } from "@/owner-client";
import { EmptyState, ListRow, Screen, SectionHeader, spacing } from "@/ui";

export { ErrorBoundary } from "@/components/route-error-boundary";

export default function OwnerTodayScreen() {
  const { today, weekStart } = portalCalendar();
  const dashboard = useOwnerDashboard(weekStart);

  return (
    <Screen
      onRefresh={() => {
        void dashboard.refetch();
      }}
      refreshing={dashboard.isRefetching}
      testID="owner-today"
      title="Today"
      updatedAt={latestDataUpdatedAt(dashboard.dataUpdatedAt)}
    >
      <OwnerGate query={dashboard}>
        {(data) => ownerSetupIncomplete(data.business) ? <FinishSetup /> : <TodayBody data={data} today={today} />}
      </OwnerGate>
    </Screen>
  );
}

function TodayBody({ data, today }: { data: OwnerDashboard; today: string }) {
  const shifts = ownerEntriesOnDate(data.entries, today);
  const tasks = ownerTasks({
    entries: shifts,
    weekEntries: data.entries,
    approvalStatus: data.approval.status,
    scheduleNote: ownerScheduleNote({
      weekStart: data.weekStart,
      weekEnd: data.weekEnd,
      approvalStatus: data.approval.status,
      assignments: data.assignments,
      entries: data.entries,
    }),
  });
  return (
    <>
      <ScheduleNote dashboard={data} />
      <Figure label={formatDayHeading(today)} value={formatMinutes(sumPaidMinutes(shifts))} />
      {tasks.length > 0 ? (
        <View style={styles.group}>
          <SectionHeader>Tasks</SectionHeader>
          {tasks.map((task) => (
            <ListRow
              icon={{ ios: "checklist", android: "checklist", web: "checklist" }}
              key={task.id}
              subtitle={task.detail}
              title={task.title}
            />
          ))}
        </View>
      ) : null}
      {shifts.length === 0 ? (
        <EmptyState
          detail="Nothing is recorded for today yet."
          icon={{ ios: "sun.max", android: "wb_sunny", web: "wb_sunny" }}
          title="No shifts today"
        />
      ) : (
        <View style={styles.shifts}>
          {shifts.map((entry) => <OwnerShiftRow entry={entry} key={entry.id} showContractor />)}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.xs,
  },
  shifts: {
    gap: spacing.xs,
  },
});
