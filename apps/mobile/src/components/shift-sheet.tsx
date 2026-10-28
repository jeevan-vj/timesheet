import {
  directionsUrl,
  formatDayHeading,
  formatShiftTime,
  shiftStatusLabel,
  type DirectionsPlatform,
  type PortalShift,
} from "@cleantrack/core/portal";
import * as Linking from "expo-linking";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PrimaryButton, SecondaryButton, StatusPill, spacing, theme, typeScale } from "@/ui";

function mapsPlatform(): DirectionsPlatform {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web";
}

export function ShiftSheet({ shift, onClose }: { shift: PortalShift | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const directions = shift ? directionsUrl(shift.address, mapsPlatform()) : null;
  const status = shift ? shiftStatusLabel(shift.occurrenceKind) : null;
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={shift != null}>
      <View style={styles.fill}>
        <Pressable accessibilityLabel="Close shift details" onPress={onClose} style={styles.backdrop} />
        {shift && status ? (
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={styles.title}>
                {shift.siteName}
              </Text>
              <StatusPill label={status} />
            </View>
            <Text style={styles.body}>{formatDayHeading(shift.workDate)}</Text>
            <Text style={styles.body}>{formatShiftTime(shift)}</Text>
            {shift.address ? (
              <Text selectable style={styles.body}>
                {shift.address}
              </Text>
            ) : null}
            <Text style={styles.muted}>{shift.businessName}</Text>
            {directions ? (
              <PrimaryButton
                accessibilityLabel={`Directions to ${shift.siteName}`}
                onPress={() => {
                  void Linking.openURL(directions);
                }}
              >
                Directions
              </PrimaryButton>
            ) : null}
            <SecondaryButton accessibilityLabel="Close shift details" onPress={onClose}>
              Close
            </SecondaryButton>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: theme.radiusLarge,
    borderTopRightRadius: theme.radiusLarge,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  heading: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    color: theme.text,
    fontSize: typeScale.title,
    lineHeight: 28,
    fontWeight: "700",
  },
  body: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 25,
    flexShrink: 1,
  },
  muted: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.subhead,
    lineHeight: 22,
    flexShrink: 1,
  },
});
