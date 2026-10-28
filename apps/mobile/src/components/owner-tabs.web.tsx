import { router, Slot, usePathname, type Href } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "@/theme";

function TabLink({ href, label, selected }: { href: Href; label: string; selected: boolean }) {
  const color = selected ? theme.accent : theme.muted;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      aria-selected={selected}
      onPress={() => router.push(href)}
      style={styles.tab}
    >
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

export default function OwnerTabs() {
  const pathname = usePathname();
  return (
    <View style={styles.screen}>
      <Slot />
      <View accessibilityRole="tablist" style={styles.list}>
        <TabLink href="/" label="Today" selected={pathname === "/"} />
        <TabLink href="/week" label="Week" selected={pathname === "/week"} />
        <TabLink href="/team" label="Team" selected={pathname === "/team"} />
        <TabLink href="/payroll" label="Payroll" selected={pathname === "/payroll"} />
        <TabLink href="/account" label="Account" selected={pathname === "/account"} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.background,
  },
  list: {
    flexDirection: "row",
    backgroundColor: theme.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.surfaceRaised,
  },
  tab: {
    flex: 1,
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
  },
});
