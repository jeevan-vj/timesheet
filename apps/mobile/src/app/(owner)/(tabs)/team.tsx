import { ownerEngagementLabel, type OwnerContractor } from "@cleantrack/core";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { OwnerContractorFormSheet } from "@/components/owner-contractor-management";
import { Figure, OwnerGate, latestDataUpdatedAt } from "@/components/owner-feedback";
import { useOwnerContractors } from "@/owner-client";
import { EmptyState, ListRow, PrimaryButton, Screen, SecondaryButton, StatusPill, spacing } from "@/ui";
import type { StatusPillLabel } from "@/ui/status-tone";

export { ErrorBoundary } from "@/components/route-error-boundary";

export default function OwnerTeamScreen() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const contractors = useOwnerContractors(includeArchived);

  return (
    <Screen
      onRefresh={() => {
        void contractors.refetch();
      }}
      refreshing={contractors.isRefetching}
      testID="owner-team"
      title="Team"
      updatedAt={latestDataUpdatedAt(contractors.dataUpdatedAt)}
    >
      <View style={styles.toolbar}>
        <PrimaryButton accessibilityLabel="Add contractor" onPress={() => setAdding(true)}>
          Add contractor
        </PrimaryButton>
        <SecondaryButton
          accessibilityLabel={includeArchived ? "Hide archived contractors" : "Show archived contractors"}
          onPress={() => setIncludeArchived((current) => !current)}
        >
          {includeArchived ? "Hide archived" : "Show archived"}
        </SecondaryButton>
      </View>
      <OwnerGate query={contractors}>
        {(data) => data.contractors.length === 0 ? (
          <EmptyState
            action={(
              <PrimaryButton accessibilityLabel="Add your first contractor" onPress={() => setAdding(true)}>
                Add your first contractor
              </PrimaryButton>
            )}
            detail={includeArchived ? "There are no archived contractors." : "Add each contractor once, then manage their portal access from the app."}
            icon={{ ios: "person.2", android: "groups", web: "groups" }}
            title={includeArchived ? "No archived contractors" : "No contractors yet"}
          />
        ) : (
          <View style={styles.list}>
            <Figure label={includeArchived ? "All contractors" : "Current contractors"} value={String(data.contractors.length)} />
            {data.contractors.map((contractor) => <ContractorRow contractor={contractor} key={contractor.id} />)}
          </View>
        )}
      </OwnerGate>
      <OwnerContractorFormSheet
        contractor={null}
        onClose={() => setAdding(false)}
        onSaved={(contractor) => {
          setAdding(false);
          router.push(`/contractors/${contractor.id}`);
        }}
        visible={adding}
      />
    </Screen>
  );
}

function ContractorRow({ contractor }: { contractor: OwnerContractor }) {
  const status = ownerEngagementLabel(contractor.engagementStatus);
  return (
    <ListRow
      accessibilityLabel={`${contractor.name}, ${status}`}
      icon={{ ios: "person", android: "person", web: "person" }}
      onPress={() => router.push(`/contractors/${contractor.id}`)}
      subtitle={status}
      title={contractor.name}
      trailing={<StatusPill label={status as StatusPillLabel} />}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  toolbar: {
    gap: spacing.sm,
  },
});
