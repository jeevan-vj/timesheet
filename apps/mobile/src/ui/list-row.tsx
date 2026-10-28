import { SymbolView } from "expo-symbols";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { spacing, theme, typeScale } from "@/ui/tokens";

type SymbolName = ComponentProps<typeof SymbolView>["name"];

export function ListRow({
  accessibilityLabel,
  icon,
  onPress,
  subtitle,
  title,
  trailing,
}: {
  accessibilityLabel?: string;
  icon: SymbolName;
  onPress?: () => void;
  subtitle?: string;
  title: string;
  trailing?: ReactNode;
}) {
  const content = (
    <>
      <View style={styles.iconCircle}>
        <SymbolView name={icon} size={19} tintColor={theme.accent} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {trailing}
      {onPress ? (
        <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={15} tintColor={theme.muted} />
      ) : null}
    </>
  );

  if (!onPress) return <View accessibilityLabel={accessibilityLabel} style={styles.row}>{content}</View>;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(", ")}
      accessibilityRole="button"
      onPress={onPress}
      pressRetentionOffset={spacing.sm}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderCurve: "continuous",
  },
  pressed: {
    backgroundColor: theme.surfaceRaised,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surfaceRaised,
  },
  copy: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 22,
    fontWeight: "600",
    flexShrink: 1,
  },
  subtitle: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.subhead,
    lineHeight: 20,
    flexShrink: 1,
  },
});
