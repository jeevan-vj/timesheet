import { formatMinutes, formatNzd } from "@cleantrack/core/week-rollup";
import { StyleSheet, Text } from "react-native";
import { PlaceholderScreen } from "@/components/placeholder-screen";
import { theme } from "@/theme";

export default function PayScreen() {
  return (
    <PlaceholderScreen title="Pay" detail={`Paid time ${formatMinutes(0)}. Approved weeks will show here.`}>
      <Text accessibilityLabel="zero dollars" maxFontSizeMultiplier={1.6} style={styles.headline}>
        {formatNzd(0)}
      </Text>
    </PlaceholderScreen>
  );
}

const styles = StyleSheet.create({
  headline: {
    color: theme.text,
    fontSize: 40,
    fontWeight: "700",
  },
});
