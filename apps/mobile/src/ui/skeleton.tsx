import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { theme } from "@/ui/tokens";

export function Skeleton({ height, style }: { height: number; style?: StyleProp<ViewStyle> }) {
  const opacity = useRef(new Animated.Value(0.45)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(0.65);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 650, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity, reduceMotion]);

  return <Animated.View accessibilityLabel="Loading" style={[styles.block, { height, opacity }, style]} />;
}

const styles = StyleSheet.create({
  block: {
    width: "100%",
    borderRadius: theme.radius,
    borderCurve: "continuous",
    backgroundColor: theme.surfaceRaised,
  },
});
