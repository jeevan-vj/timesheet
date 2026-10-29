import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import {
  WORKSPACE_CHOICE_KEY,
  clearWorkspaceChoice,
  parseWorkspaceChoice,
  readWorkspaceChoice,
  writeWorkspaceChoice,
} from "../apps/mobile/src/workspace-choice";

const stored = new Map<string, string>();
const storage = {
  getItem: async (key: string) => stored.get(key) ?? null,
  setItem: async (key: string, value: string) => { stored.set(key, value); },
  removeItem: async (key: string) => { stored.delete(key); },
};

describe("mobile workspace choice persistence", () => {
  beforeEach(() => stored.clear());

  it("persists only an owner or contractor choice across a reload", async () => {
    expect(parseWorkspaceChoice(null)).toBeNull();
    expect(parseWorkspaceChoice("other")).toBeNull();
    await writeWorkspaceChoice("contractor", storage);
    expect(stored.get(WORKSPACE_CHOICE_KEY)).toBe("contractor");
    expect(await readWorkspaceChoice(storage)).toBe("contractor");
    await writeWorkspaceChoice("owner", storage);
    expect(await readWorkspaceChoice(storage)).toBe("owner");
  });

  it("clears the choice during sign out", async () => {
    await writeWorkspaceChoice("owner", storage);
    await clearWorkspaceChoice(storage);
    expect(await readWorkspaceChoice(storage)).toBeNull();
    expect(readFileSync("apps/mobile/src/api.ts", "utf8")).toContain("await clearWorkspaceChoice()");
  });
});
