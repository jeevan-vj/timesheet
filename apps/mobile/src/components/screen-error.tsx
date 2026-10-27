import { Pressable, StyleSheet, Text, View } from "react-native";
import { screenErrorCause, screenErrorTrace } from "@/screen-error-cause";
import { theme } from "@/theme";

export function ScreenError({
  error,
  retry,
  componentStack,
}: {
  error: { name?: string; message?: string; stack?: string };
  retry: () => void | Promise<void>;
  componentStack?: string | null;
}) {
  const trace = screenErrorTrace(error, componentStack);
  return (
    <View style={styles.screen}>
      <Text accessibilityRole="header" style={styles.title}>
        Something went wrong
      </Text>
      <Text style={styles.detail}>This screen could not be shown. Try again.</Text>
      <Text style={styles.cause}>{screenErrorCause(error)}</Text>
      {trace ? (
        <Text selectable style={styles.trace}>
          {trace}
        </Text>
      ) : null}
      <Pressable
        accessibilityLabel="Try again"
        onPress={() => {
          void retry();
        }}
        style={styles.button}
      >
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
  cause: {
    color: theme.muted,
    fontSize: 13,
    lineHeight: 18,
    flexShrink: 1,
  },
  trace: {
    color: theme.muted,
    fontSize: 11,
    lineHeight: 16,
    flexShrink: 1,
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
