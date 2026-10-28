import {
  formatDayHeading,
  formatNzd,
  isIsoDate,
  ownerEngagementLabel,
  ownerInvitationLabel,
  type OwnerContractor,
  type OwnerInvitation,
} from "@cleantrack/core";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { OwnerFailure, OwnerGate, OwnerLoading, RefreshWarning, latestDataUpdatedAt } from "@/components/owner-feedback";
import { useOwnerContractor, useOwnerInvitation } from "@/owner-client";
import { Card, Screen, spacing, theme, typeScale } from "@/ui";

export { ErrorBoundary } from "@/components/route-error-boundary";

function oneParam(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

function dateLabel(value: string | null): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  if (!isIsoDate(date)) return null;
  return formatDayHeading(date);
}

export default function OwnerContractorScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = oneParam(params.id);
  const contractor = useOwnerContractor(id);
  const invitation = useOwnerInvitation(id);

  return (
    <Screen
      onRefresh={() => {
        void contractor.refetch();
        void invitation.refetch();
      }}
      refreshing={contractor.isRefetching || invitation.isRefetching}
      testID="owner-contractor"
      title="Contractor"
      updatedAt={latestDataUpdatedAt(contractor.dataUpdatedAt, invitation.dataUpdatedAt)}
    >
      <Pressable
        accessibilityLabel="Back to team"
        accessibilityRole="button"
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/team");
        }}
        style={styles.back}
      >
        <Text style={styles.backText}>Team</Text>
      </Pressable>
      <OwnerGate query={contractor}>
        {(person) => (
          <>
            <ContractorDetail contractor={person} />
            <InvitationDetail query={invitation} />
          </>
        )}
      </OwnerGate>
    </Screen>
  );
}

function ContractorDetail({ contractor }: { contractor: OwnerContractor }) {
  const started = dateLabel(contractor.startDate);
  const preferred = contractor.preferredName.trim();
  return (
    <Card>
      <Text style={styles.name}>{contractor.name}</Text>
      <Text style={styles.sub}>{ownerEngagementLabel(contractor.engagementStatus)}</Text>
      {preferred && preferred !== contractor.name ? <Text style={styles.body}>Preferred name {preferred}</Text> : null}
      {contractor.email ? <Text selectable style={styles.body}>{contractor.email}</Text> : null}
      {contractor.phone ? <Text selectable style={styles.body}>{contractor.phone}</Text> : null}
      <Text style={styles.body}>{formatNzd(contractor.defaultRateCents)}/hr</Text>
      {started ? <Text style={styles.sub}>Started {started}</Text> : null}
      {contractor.gstRegistered ? <Text style={styles.sub}>{contractor.gstNumber ? `GST ${contractor.gstNumber}` : "GST registered"}</Text> : null}
      {contractor.emergencyContactName || contractor.emergencyContactPhone ? (
        <Text style={styles.sub}>
          Emergency contact {[contractor.emergencyContactName, contractor.emergencyContactPhone].filter(Boolean).join(", ")}
        </Text>
      ) : null}
      {contractor.internalNotes.trim() ? <Text selectable style={styles.body}>{contractor.internalNotes}</Text> : null}
    </Card>
  );
}

function InvitationDetail({ query }: { query: ReturnType<typeof useOwnerInvitation> }) {
  if (query.data == null && query.isPending) return <OwnerLoading />;
  if (query.data == null && query.isError) return <OwnerFailure error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data == null) return null;
  return (
    <View style={styles.invitation}>
      <RefreshWarning visible={query.isError} />
      <InvitationCard invitation={query.data} />
    </View>
  );
}

function InvitationCard({ invitation }: { invitation: OwnerInvitation }) {
  const expires = dateLabel(invitation.expiresAt);
  return (
    <Card>
      <Text style={styles.kicker}>Portal invitation</Text>
      <Text style={styles.body}>{ownerInvitationLabel(invitation.state)}</Text>
      {expires ? <Text style={styles.sub}>Expires {expires}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: "flex-start",
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    justifyContent: "center",
  },
  backText: {
    color: theme.accent,
    fontSize: typeScale.body,
    fontWeight: "700",
  },
  name: {
    color: theme.text,
    fontSize: typeScale.title,
    lineHeight: 28,
    fontWeight: "700",
  },
  kicker: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.caption,
    lineHeight: 18,
    fontWeight: "700",
  },
  body: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 25,
  },
  sub: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
  invitation: {
    gap: spacing.xs,
  },
});
