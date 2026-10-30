import type { ReactNode } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SecondaryButton } from "@/ui/buttons";
import { spacing, theme, typeScale } from "@/ui/tokens";

export function Sheet({
  children,
  closeLabel = "Close",
  onClose,
  title,
  visible,
}: {
  children: ReactNode;
  closeLabel?: string;
  onClose: () => void;
  title: string;
  visible: boolean;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <SafeAreaView accessibilityViewIsModal style={styles.sheet}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        <SecondaryButton accessibilityLabel={closeLabel} onPress={onClose}>
          Close
        </SecondaryButton>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: theme.background,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  header: {
    paddingTop: spacing.sm,
  },
  title: {
    color: theme.text,
    fontSize: typeScale.title,
    lineHeight: 28,
    fontWeight: "700",
    flexShrink: 1,
  },
  content: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
});
