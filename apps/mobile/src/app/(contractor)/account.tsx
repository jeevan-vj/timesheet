import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { endSession } from "@/api";
import { authClient } from "@/auth-client";
import { PlaceholderScreen } from "@/components/placeholder-screen";
import { SignedInIdentity } from "@/components/signed-in-identity";
import { theme } from "@/theme";

export default function AccountScreen() {
  const { data } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const email = data?.user.email?.trim() ?? "";

  function confirmSignOut() {
    Alert.alert("Sign out?", "You will need your email and password to sign in again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          setBusy(true);
          void endSession().finally(() => setBusy(false));
        },
      },
    ]);
  }

  return (
    <PlaceholderScreen title="Account" detail="Signed in on this device.">
      <SignedInIdentity />
      {email ? <Text style={styles.email}>{email}</Text> : null}
      <Pressable
        accessibilityLabel={busy ? "Signing out" : "Sign out"}
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={confirmSignOut}
        style={styles.button}
      >
        <Text style={styles.buttonText}>{busy ? "Signing out…" : "Sign out"}</Text>
      </Pressable>
    </PlaceholderScreen>
  );
}

const styles = StyleSheet.create({
  email: {
    color: theme.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  button: {
    alignSelf: "flex-start",
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    paddingHorizontal: 20,
    borderRadius: theme.radiusLarge,
    backgroundColor: theme.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: "700",
  },
});
