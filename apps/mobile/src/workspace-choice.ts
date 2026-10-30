import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WorkspaceChoice } from "./role-route";

export const WORKSPACE_CHOICE_KEY = "cleantrack-workspace-choice";

export type WorkspaceChoiceStorage = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem">;

export function parseWorkspaceChoice(value: string | null): WorkspaceChoice | null {
  return value === "owner" || value === "contractor" ? value : null;
}

export async function readWorkspaceChoice(storage: WorkspaceChoiceStorage = AsyncStorage): Promise<WorkspaceChoice | null> {
  return parseWorkspaceChoice(await storage.getItem(WORKSPACE_CHOICE_KEY));
}

export async function writeWorkspaceChoice(
  choice: WorkspaceChoice,
  storage: WorkspaceChoiceStorage = AsyncStorage,
): Promise<void> {
  await storage.setItem(WORKSPACE_CHOICE_KEY, choice);
}

export async function clearWorkspaceChoice(storage: WorkspaceChoiceStorage = AsyncStorage): Promise<void> {
  await storage.removeItem(WORKSPACE_CHOICE_KEY);
}
