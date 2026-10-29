import * as Linking from "expo-linking";
import { useState } from "react";
import { Alert, Platform, StyleSheet, Text, View } from "react-native";
import { endSession } from "@/api";
import { authClient } from "@/auth-client";
import { SignedInIdentity } from "@/components/signed-in-identity";
import { WorkspaceSwitchSection } from "@/components/workspace-switcher";
import { accountWebUrl, formatAppBuild } from "@/contractor-view";
import { apiBaseUrl, appVersion, updateChannel } from "@/runtime-config";
import { useCurrentViewer } from "@/viewer-context";
import {
  DestructiveButton,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  SectionHeader,
  Skeleton,
  spacing,
  theme,
  typeScale,
} from "@/ui";

export { ErrorBoundary } from "@/components/route-error-boundary";

export default function AccountScreen() {
  const { data } = authClient.useSession();
  const viewer = useCurrentViewer();
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [linkError, setLinkError] = useState("");
  const name = data?.user.name?.trim() || "Signed in";
  const email = data?.user.email?.trim() ?? "";

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

  async function openWeb(link: "help" | "resetPassword") {
    setLinkError("");
    try {
      await Linking.openURL(accountWebUrl(apiBaseUrl(), link));
    } catch {
      setLinkError("Could not open the CleanTrack website.");
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await viewer.reload();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Screen
      onRefresh={() => {
        void refresh();
      }}
      refreshing={refreshing}
      testID="contractor-account"
      title="Account"
      updatedAt={null}
    >
      <SignedInIdentity email={email} name={name} role={viewer.label} roleState={viewer.status} />
      {viewer.status === "loading" ? (
        <View accessibilityLabel="Loading account" style={styles.skeletons}>
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      ) : null}
      {viewer.status === "error" ? (
        <ErrorState message="Your account details are unavailable." onRetry={() => void viewer.reload()} />
      ) : null}
      {viewer.status === "ready" ? (
        <View style={styles.section}>
          <SectionHeader>Working for</SectionHeader>
          {viewer.contractorOf.length === 0 ? (
            <EmptyState
              detail="When a business links this account, the name will show up here."
              icon={{ ios: "building.2", android: "business", web: "business" }}
              title="No businesses linked"
            />
          ) : (
            viewer.contractorOf.map((link) => (
              <ListRow
                icon={{ ios: "building.2", android: "business", web: "business" }}
                key={link.businessId}
                title={link.businessName}
              />
            ))
          )}
        </View>
      ) : null}
      <WorkspaceSwitchSection />
      <View style={styles.section}>
        <SectionHeader>Website</SectionHeader>
        <ListRow
          accessibilityLabel="Reset password on web"
          icon={{ ios: "key", android: "key", web: "key" }}
          onPress={() => {
            void openWeb("resetPassword");
          }}
          subtitle="Opens the CleanTrack website"
          title="Reset password on web"
        />
        <ListRow
          accessibilityLabel="Help"
          icon={{ ios: "questionmark.circle", android: "help", web: "help" }}
          onPress={() => {
            void openWeb("help");
          }}
          subtitle="Opens the CleanTrack website"
          title="Help"
        />
        {linkError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {linkError}
          </Text>
        ) : null}
      </View>
      <Text style={styles.version}>{formatAppBuild(appVersion(), updateChannel())}</Text>
      <DestructiveButton
        accessibilityLabel={busy ? "Signing out" : "Sign out"}
        busy={busy}
        disabled={busy}
        onPress={confirmSignOut}
      >
        {busy ? "Signing out…" : "Sign out"}
      </DestructiveButton>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.xs,
  },
  skeletons: {
    gap: spacing.sm,
  },
  error: {
    color: theme.text,
    backgroundColor: theme.surfaceRaised,
    borderRadius: theme.radius,
    borderCurve: "continuous",
    padding: spacing.sm,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
  version: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.caption,
    lineHeight: 18,
  },
});
