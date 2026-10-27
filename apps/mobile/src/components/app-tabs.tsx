import { NativeTabs } from "expo-router/native-tabs";
import { DynamicColorIOS, Platform } from "react-native";
import { theme } from "@/theme";

function tabTint() {
  if (Platform.OS === "ios") return DynamicColorIOS({ dark: theme.accent, light: theme.accent });
  return theme.accent;
}

export default function AppTabs() {
  return (
    <NativeTabs
      tintColor={tabTint()}
      backgroundColor={theme.background}
      labelStyle={{ selected: { color: theme.accent } }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="week">
        <NativeTabs.Trigger.Label>My week</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="pay">
        <NativeTabs.Trigger.Label>Pay</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="banknote" md="payments" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
