import { Pressable, StyleSheet, Text } from "react-native";
import { authClient } from "@/auth-client";
import { theme } from "@/theme";
import { useViewer } from "@/use-viewer";

export function SignedInIdentity() {
  const { data } = authClient.useSession();
  const viewer = useViewer();
  const name = data?.user.name?.trim() || "Signed in";
  return (
    <>
      <Text style={styles.name}>{name}</Text>
      {viewer.status === "loading" ? <Text style={styles.role}>Loading your role</Text> : null}
      {viewer.status === "ready" ? (
        <Text accessibilityLabel={`Role, ${viewer.label}`} style={styles.role}>
          {viewer.label}
        </Text>
      ) : null}
      {viewer.status === "error" ? (
        <>
          <Text accessibilityRole="alert" style={styles.role}>
            Could not load your role.
          </Text>
          <Pressable
            accessibilityLabel="Try again"
            accessibilityRole="button"
            onPress={() => {
              void viewer.reload();
            }}
            style={styles.retry}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  name: {
    color: theme.text,
    fontSize: 20,
    fontWeight: "700",
  },
  role: {
    color: theme.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  retry: {
    alignSelf: "flex-start",
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    justifyContent: "center",
  },
  retryText: {
    color: theme.accent,
    fontSize: 16,
    fontWeight: "700",
  },
});
