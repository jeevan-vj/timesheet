import { offlineBannerText } from "@cleantrack/core/portal";
import type { ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useOnline } from "@/online";
import { theme } from "@/theme";

type ScreenScrollProps = {
  title: string;
  testID: string;
  updatedAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
};

export function ScreenScroll({ title, testID, updatedAt, refreshing, onRefresh, children }: ScreenScrollProps) {
  const online = useOnline();
  return (
    <SafeAreaView style={styles.screen} testID={testID}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            accessibilityLabel="Refresh"
            colors={[theme.accent]}
            onRefresh={onRefresh}
            refreshing={refreshing}
            tintColor={theme.accent}
          />
        }
      >
        {online ? null : (
          <Text accessibilityRole="alert" style={styles.offline}>
            {offlineBannerText(updatedAt)}
          </Text>
        )}
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.background,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 12,
  },
  offline: {
    color: theme.text,
    backgroundColor: theme.surfaceRaised,
    borderRadius: theme.radius,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    lineHeight: 24,
  },
  title: {
    color: theme.text,
    fontSize: 32,
    fontWeight: "700",
    flexShrink: 1,
  },
});
