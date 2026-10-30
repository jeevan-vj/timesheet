import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  contractorWorkspaceLabel,
  nextWorkspace,
  type WorkspaceChoice,
} from "@/role-route";
import { ListRow, SecondaryButton, SectionHeader, spacing, theme, typeScale } from "@/ui";
import { useCurrentViewer } from "@/viewer-context";

function switchLabel(target: WorkspaceChoice, businessLabel: string): string {
  return target === "owner" ? "Owner workspace" : businessLabel;
}

function useWorkspaceSwitch() {
  const viewer = useCurrentViewer();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = viewer.workspace === "owner" ? "owner" : "contractor";
  const target = nextWorkspace(current);
  const label = switchLabel(target, contractorWorkspaceLabel(viewer.contractorOf));

  const select = async () => {
    if (busy || !viewer.canSwitchWorkspace) return;
    setBusy(true);
    setError("");
    try {
      await viewer.selectWorkspace(target);
      router.replace(target === "owner" ? "/(owner)/(tabs)" : "/(contractor)/(tabs)");
    } catch {
      setError("Could not switch workspace. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return { busy, canSwitch: viewer.canSwitchWorkspace, error, label, select };
}

export function WorkspaceSwitchButton() {
  const workspace = useWorkspaceSwitch();
  if (!workspace.canSwitch) return null;
  return (
    <View style={styles.container}>
      <SecondaryButton
        accessibilityLabel={`Switch to ${workspace.label}`}
        busy={workspace.busy}
        disabled={workspace.busy}
        onPress={() => void workspace.select()}
        style={styles.chip}
      >
        {workspace.busy ? "Switching…" : workspace.label}
      </SecondaryButton>
      {workspace.error ? <Text accessibilityRole="alert" style={styles.error}>{workspace.error}</Text> : null}
    </View>
  );
}

export function WorkspaceSwitchRow() {
  const workspace = useWorkspaceSwitch();
  if (!workspace.canSwitch) return null;
  return (
    <View style={styles.container}>
      <ListRow
        accessibilityLabel={`Switch to ${workspace.label}`}
        icon={{ ios: "arrow.triangle.swap", android: "swap_horiz", web: "swap_horiz" }}
        onPress={() => void workspace.select()}
        subtitle={workspace.busy ? "Switching workspace…" : "Replace this workspace with the other view"}
        title={workspace.label}
      />
      {workspace.error ? <Text accessibilityRole="alert" style={styles.error}>{workspace.error}</Text> : null}
    </View>
  );
}

export function WorkspaceSwitchSection() {
  const viewer = useCurrentViewer();
  if (!viewer.canSwitchWorkspace) return null;
  return (
    <View style={styles.container}>
      <SectionHeader>Workspace</SectionHeader>
      <WorkspaceSwitchRow />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  chip: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
  },
  error: {
    color: theme.text,
    fontSize: typeScale.caption,
    lineHeight: 18,
  },
});
