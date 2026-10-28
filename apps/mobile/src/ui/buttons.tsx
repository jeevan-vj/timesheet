import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { spacing, statusColors, theme, typeScale } from "@/ui/tokens";

type ButtonProps = {
  accessibilityLabel: string;
  busy?: boolean;
  children: ReactNode;
  disabled?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

function Button({
  accessibilityLabel,
  busy = false,
  children,
  disabled,
  onPress,
  style,
  tone,
}: ButtonProps & { tone: "primary" | "secondary" | "destructive" }) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      pressRetentionOffset={spacing.sm}
      style={({ pressed }) => [
        styles.button,
        tone === "primary" ? styles.primary : tone === "destructive" ? styles.destructive : styles.secondary,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {typeof children === "string" ? (
        <Text style={[styles.label, tone === "primary" ? styles.primaryLabel : tone === "destructive" ? styles.destructiveLabel : styles.secondaryLabel]}>
          {children}
        </Text>
      ) : children}
    </Pressable>
  );
}

export function PrimaryButton(props: ButtonProps) {
  return <Button {...props} tone="primary" />;
}

export function SecondaryButton(props: ButtonProps) {
  return <Button {...props} tone="secondary" />;
}

export function DestructiveButton(props: ButtonProps) {
  return <Button {...props} tone="destructive" />;
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
  destructive: {
    backgroundColor: theme.surfaceRaised,
    borderWidth: 1,
    borderColor: statusColors.danger,
  },
  secondaryLabel: {
    color: theme.accent,
  },
  destructiveLabel: {
    color: statusColors.danger,
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.42,
  },
});
