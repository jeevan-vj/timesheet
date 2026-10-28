import { NativeTabs } from "expo-router/native-tabs";
import { DynamicColorIOS, Platform } from "react-native";
import { theme } from "@/theme";

function tabTint() {
  if (Platform.OS === "ios") return DynamicColorIOS({ dark: theme.accent, light: theme.accent });
  return theme.accent;
}

export default function OwnerTabs() {
  return (
    <NativeTabs tintColor={tabTint()} labelStyle={{ selected: { color: theme.accent } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sun.max.fill" md="wb_sunny" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="week">
        <NativeTabs.Trigger.Label>Week</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="team">
        <NativeTabs.Trigger.Label>Team</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.2.fill" md="groups" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="payroll">
        <NativeTabs.Trigger.Label>Payroll</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="banknote" md="payments" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
