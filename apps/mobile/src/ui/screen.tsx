import { offlineBannerText } from "@cleantrack/core/portal";
import type { ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useOnline } from "@/online";
import { spacing, theme, typeScale } from "@/ui/tokens";

type ScreenProps = {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  testID?: string;
  title: string;
  updatedAt?: number | null;
};

export function Screen({ children, onRefresh, refreshing = false, testID, title, updatedAt = null }: ScreenProps) {
  const online = useOnline();
  const refreshControl = onRefresh ? (
    <RefreshControl
      accessibilityLabel="Refresh"
      colors={[theme.accent]}
      onRefresh={onRefresh}
      refreshing={refreshing}
      tintColor={theme.accent}
    />
  ) : undefined;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={refreshControl}
      style={styles.screen}
      testID={testID}
    >
      {online ? null : (
        <Text accessibilityRole="alert" style={styles.offline}>
          {offlineBannerText(updatedAt)}
        </Text>
      )}
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      </View>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.background,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  heading: {
    paddingBottom: spacing.xs,
  },
  title: {
    color: theme.text,
    fontSize: typeScale.largeTitle,
    lineHeight: 41,
    fontWeight: "700",
    flexShrink: 1,
  },
  offline: {
    color: theme.text,
    backgroundColor: theme.surfaceRaised,
    borderRadius: theme.radius,
    borderCurve: "continuous",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
});
