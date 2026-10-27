import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "@/theme";

type PlaceholderScreenProps = {
  title: string;
  detail: string;
  children?: ReactNode;
};

export function PlaceholderScreen({ title, detail, children }: PlaceholderScreenProps) {
  return (
    <SafeAreaView style={styles.screen}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={styles.detail}>{detail}</Text>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.background,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
  },
  title: {
    color: theme.text,
    fontSize: 32,
    fontWeight: "700",
  },
  detail: {
    color: theme.muted,
    fontSize: 16,
    lineHeight: 24,
  },
});
