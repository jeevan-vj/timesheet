import { ownerEngagementLabel, type OwnerContractor } from "@cleantrack/core";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Figure, OwnerGate, latestDataUpdatedAt } from "@/components/owner-feedback";
import { useOwnerContractors } from "@/owner-client";
import { EmptyState, ListRow, Screen, spacing } from "@/ui";

export { ErrorBoundary } from "@/components/route-error-boundary";

export default function OwnerTeamScreen() {
  const contractors = useOwnerContractors();

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
      <OwnerGate query={contractors}>
        {(data) => data.contractors.length === 0 ? (
          <EmptyState
            detail="Contractors you add on the web show up here."
            icon={{ ios: "person.2", android: "groups", web: "groups" }}
            title="No contractors yet"
          />
        ) : (
          <View style={styles.list}>
            <Figure label="Contractors" value={String(data.contractors.length)} />
            {data.contractors.map((contractor) => <ContractorRow contractor={contractor} key={contractor.id} />)}
          </View>
        )}
      </OwnerGate>
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
    />
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
});
