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
  type OwnerEntry,
} from "@cleantrack/core";
import { useState } from "react";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Figure, FinishSetup, OwnerGate, ScheduleNote, latestDataUpdatedAt } from "@/components/owner-feedback";
import { OwnerShiftRow } from "@/components/owner-shift-row";
import { OwnerShiftSheet } from "@/components/owner-shift-sheet";
import { WorkspaceSwitchButton } from "@/components/workspace-switcher";
import { useOwnerDashboard } from "@/owner-client";
import { Card, EmptyState, ListRow, PrimaryButton, Screen, SectionHeader, spacing, theme, typeScale } from "@/ui";

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
      <WorkspaceSwitchButton />
      <OwnerGate query={dashboard}>
        {(data) => ownerSetupIncomplete(data.business) ? <FinishSetup /> : <TodayBody data={data} today={today} />}
      </OwnerGate>
    </Screen>
  );
}

function TodayBody({ data, today }: { data: OwnerDashboard; today: string }) {
  const [selectedEntry, setSelectedEntry] = useState<OwnerEntry | null>(null);
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
      <Card>
        <Text style={styles.assistantTitle}>Ask CleanTrack</Text>
        <Text style={styles.assistantDetail}>Create team records, assign sites, or verify a remittance in a conversation.</Text>
        <PrimaryButton accessibilityLabel="Open owner assistant" onPress={() => router.push("/(owner)/assistant")}>Open assistant</PrimaryButton>
      </Card>
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
          {shifts.map((entry) => (
            <OwnerShiftRow entry={entry} key={entry.id} onPress={() => setSelectedEntry(entry)} showContractor />
          ))}
        </View>
      )}
      <OwnerShiftSheet
        approvalStatus={data.approval.status}
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
      />
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
  assistantTitle: { color: theme.text, fontSize: typeScale.body, fontWeight: "700" },
  assistantDetail: { color: theme.mutedHighContrast, fontSize: typeScale.subhead, lineHeight: 21 },
});
