import { StyleSheet, Text } from "react-native";
import { theme, typeScale } from "@/ui/tokens";

export function SectionHeader({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

const styles = StyleSheet.create({
  label: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.subhead,
    fontWeight: "700",
    lineHeight: 20,
  },
});
