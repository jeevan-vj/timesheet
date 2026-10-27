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
import { theme } from "@/theme";

function mapsPlatform(): DirectionsPlatform {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web";
}

export function ShiftSheet({ shift, onClose }: { shift: PortalShift | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const directions = shift ? directionsUrl(shift.address, mapsPlatform()) : null;
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={shift != null}>
      <View style={styles.fill}>
        <Pressable accessibilityLabel="Close shift details" onPress={onClose} style={styles.backdrop} />
        {shift ? (
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Text accessibilityRole="header" style={styles.title}>
              {shift.siteName}
            </Text>
            <Text style={styles.body}>{shiftStatusLabel(shift.occurrenceKind)}</Text>
            <Text style={styles.body}>{formatDayHeading(shift.workDate)}</Text>
            <Text style={styles.body}>{formatShiftTime(shift)}</Text>
            {shift.address ? <Text style={styles.body}>{shift.address}</Text> : null}
            <Text style={styles.body}>{shift.businessName}</Text>
            {directions ? (
              <Pressable
                accessibilityLabel={`Directions to ${shift.siteName}`}
                accessibilityRole="link"
                onPress={() => {
                  void Linking.openURL(directions);
                }}
                style={styles.primary}
              >
                <Text style={styles.primaryText}>Directions</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityLabel="Close shift details" accessibilityRole="button" onPress={onClose} style={styles.secondary}>
              <Text style={styles.secondaryText}>Close</Text>
            </Pressable>
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
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 8,
  },
  title: {
    color: theme.text,
    fontSize: 28,
    fontWeight: "700",
    flexShrink: 1,
  },
  body: {
    color: theme.text,
    fontSize: 16,
    lineHeight: 24,
    flexShrink: 1,
  },
  primary: {
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    borderRadius: theme.radiusLarge,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    marginTop: 8,
  },
  primaryText: {
    color: theme.accentText,
    fontSize: 16,
    fontWeight: "700",
  },
  secondary: {
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: {
    color: theme.accent,
    fontSize: 16,
    fontWeight: "700",
  },
});
