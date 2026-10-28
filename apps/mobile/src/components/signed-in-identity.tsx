import { StyleSheet, Text } from "react-native";
import { Card, Skeleton, theme, typeScale } from "@/ui";

export function SignedInIdentity({
  email,
  name,
  role,
  roleState,
}: {
  email: string;
  name: string;
  role: string;
  roleState: "loading" | "ready" | "error";
}) {
  return (
    <Card>
      <Text style={styles.name}>{name}</Text>
      {email ? (
        <Text selectable style={styles.email}>
          {email}
        </Text>
      ) : null}
      {roleState === "ready" ? (
        <Text accessibilityLabel={`Role, ${role}`} style={styles.role}>
          {role}
        </Text>
      ) : null}
      {roleState === "loading" ? <Skeleton height={22} /> : null}
      {roleState === "error" ? (
        <Text accessibilityRole="alert" style={styles.role}>
          Could not load your role.
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  name: {
    color: theme.text,
    fontSize: typeScale.title,
    lineHeight: 28,
    fontWeight: "700",
  },
  email: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.body,
    lineHeight: 25,
  },
  role: {
    color: theme.text,
    fontSize: typeScale.subhead,
    lineHeight: 22,
    fontWeight: "600",
  },
});
