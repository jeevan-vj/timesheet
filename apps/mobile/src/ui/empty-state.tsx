import { SymbolView } from "expo-symbols";
import type { ComponentProps, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "@/ui/card";
import { spacing, theme, typeScale } from "@/ui/tokens";

type SymbolName = ComponentProps<typeof SymbolView>["name"];

export function EmptyState({ icon, title, detail, action }: { icon: SymbolName; title: string; detail: string; action?: ReactNode }) {
  return (
    <Card style={styles.card}>
      <View style={styles.iconCircle}>
        <SymbolView name={icon} size={26} tintColor={theme.accent} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
      {action}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "flex-start",
    padding: spacing.lg,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surfaceRaised,
  },
  title: {
    color: theme.text,
    fontSize: typeScale.title,
    lineHeight: 28,
    fontWeight: "700",
  },
  detail: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.body,
    lineHeight: 25,
  },
});
