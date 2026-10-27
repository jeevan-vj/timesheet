import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "@/theme";

export function ScreenError({ retry }: { retry: () => void }) {
  return (
    <View style={styles.screen}>
      <Text accessibilityRole="header" style={styles.title}>
        Something went wrong
      </Text>
      <Text style={styles.detail}>This screen could not be shown. Try again.</Text>
      <Pressable accessibilityLabel="Try again" onPress={retry} style={styles.button}>
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.background,
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: {
    color: theme.text,
    fontSize: 28,
    fontWeight: "700",
  },
  detail: {
    color: theme.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  button: {
    alignSelf: "flex-start",
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    paddingHorizontal: 20,
    borderRadius: theme.radiusLarge,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: theme.accentText,
    fontSize: 16,
    fontWeight: "700",
  },
});
