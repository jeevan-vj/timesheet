import { ownerSetupIncomplete, type OwnerMe, type OwnerSite } from "@cleantrack/core";
import { useState } from "react";
import { Alert, Platform, StyleSheet, Text, View } from "react-native";
import { endSession } from "@/api";
import { authClient } from "@/auth-client";
import { Figure, FinishSetup, OwnerFailure, OwnerLoading, RefreshWarning, latestDataUpdatedAt } from "@/components/owner-feedback";
import { WorkspaceSwitchSection } from "@/components/workspace-switcher";
import { useOwnerMe, useOwnerSites } from "@/owner-client";
import { Card, EmptyState, ListRow, Screen, SecondaryButton, SectionHeader, spacing, theme, typeScale } from "@/ui";

export { ErrorBoundary } from "@/components/route-error-boundary";

export default function OwnerAccountScreen() {
  const me = useOwnerMe();
  const sites = useOwnerSites();
  const [busy, setBusy] = useState(false);
  const session = authClient.useSession();
  const name = session.data?.user.name?.trim() || "Signed in";
  const email = session.data?.user.email?.trim() ?? "";

  function confirmSignOut() {
    const signOut = () => {
      setBusy(true);
      void endSession().finally(() => setBusy(false));
    };
    const message = "You will need your email and password to sign in again.";
    if (Platform.OS === "web") {
      if (globalThis.confirm(`Sign out? ${message}`)) signOut();
      return;
    }
    Alert.alert("Sign out?", message, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: signOut },
    ]);
  }

  const refresh = () => {
    void me.refetch();
    void sites.refetch();
  };

  return (
    <Screen
      onRefresh={refresh}
      refreshing={me.isRefetching || sites.isRefetching}
      testID="owner-account"
      title="Account"
      updatedAt={latestDataUpdatedAt(me.dataUpdatedAt, sites.dataUpdatedAt)}
    >
      {me.data == null && me.isPending ? <OwnerLoading /> : null}
      {me.data == null && me.isError ? <OwnerFailure error={me.error} onRetry={refresh} /> : null}
      {me.data ? (
        <>
          <RefreshWarning visible={me.isError} />
          {ownerSetupIncomplete(me.data.owner) ? <FinishSetup /> : (
            <>
              <Profile business={me.data.owner} email={email} name={name} />
              <SitesSection sites={sites} />
            </>
          )}
        </>
      ) : null}
      <WorkspaceSwitchSection />
      <SecondaryButton
        accessibilityLabel={busy ? "Signing out" : "Sign out"}
        disabled={busy}
        onPress={confirmSignOut}
      >
        {busy ? "Signing out…" : "Sign out"}
      </SecondaryButton>
    </Screen>
  );
}

function Profile({ business, email, name }: { business: NonNullable<OwnerMe["owner"]>; email: string; name: string }) {
  return (
    <>
      <Figure label="Business" value={business.name || "Business"} />
      <Card>
        <Text style={styles.kicker}>Signed in</Text>
        <Text style={styles.body}>{name}</Text>
        <Text style={styles.sub}>Owner</Text>
        {email ? <Text selectable style={styles.sub}>{email}</Text> : null}
      </Card>
      <Card>
        <Text style={styles.kicker}>Business details</Text>
        {business.address ? <Text selectable style={styles.body}>{business.address}</Text> : null}
        {business.contactEmail ? <Text selectable style={styles.sub}>{business.contactEmail}</Text> : null}
        {business.contactPhone ? <Text selectable style={styles.sub}>{business.contactPhone}</Text> : null}
        {business.nzbn ? <Text selectable style={styles.sub}>NZBN {business.nzbn}</Text> : null}
        <Text style={styles.sub}>{business.timezone}</Text>
      </Card>
    </>
  );
}

function SitesSection({ sites }: { sites: ReturnType<typeof useOwnerSites> }) {
  return (
    <View style={styles.sites}>
      <SectionHeader>Sites</SectionHeader>
      {sites.data == null && sites.isPending ? <OwnerLoading /> : null}
      {sites.data == null && sites.isError ? <OwnerFailure error={sites.error} onRetry={() => void sites.refetch()} /> : null}
      {sites.data && sites.data.length === 0 ? (
        <EmptyState
          detail="Sites you add on the web show up here."
          icon={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }}
          title="No sites yet"
        />
      ) : null}
      {sites.data && sites.data.length > 0 ? sites.data.map((site) => <SiteRow key={site.id} site={site} />) : null}
    </View>
  );
}

function SiteRow({ site }: { site: OwnerSite }) {
  return (
    <ListRow
      accessibilityLabel={site.address ? `${site.name}, ${site.address}` : site.name}
      icon={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }}
      subtitle={site.address || "No address"}
      title={site.name}
    />
  );
}

const styles = StyleSheet.create({
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
    fontWeight: "600",
  },
  sub: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
  sites: {
    gap: spacing.xs,
  },
});
