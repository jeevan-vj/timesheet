import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { spacing, theme, typeScale } from "@/ui/tokens";

type ButtonProps = {
  accessibilityLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

function Button({ accessibilityLabel, children, disabled, onPress, style, primary }: ButtonProps & { primary: boolean }) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      pressRetentionOffset={spacing.sm}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.primary : styles.secondary,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {typeof children === "string" ? (
        <Text style={[styles.label, primary ? styles.primaryLabel : styles.secondaryLabel]}>{children}</Text>
      ) : children}
    </Pressable>
  );
}

export function PrimaryButton(props: ButtonProps) {
  return <Button {...props} primary />;
}

export function SecondaryButton(props: ButtonProps) {
  return <Button {...props} primary={false} />;
}

const styles = StyleSheet.create({
  button: {
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    borderRadius: 999,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: {
    backgroundColor: theme.accent,
  },
  secondary: {
    backgroundColor: theme.surfaceRaised,
  },
  label: {
    fontSize: typeScale.body,
    fontWeight: "700",
    textAlign: "center",
  },
  primaryLabel: {
    color: theme.accentText,
  },
  secondaryLabel: {
    color: theme.accent,
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.42,
  },
});
