import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "owner-a", email: "owner@example.test", name: "Owner" } as { id: string; email: string; name: string } | null,
}));
const plan = vi.hoisted(() => vi.fn());
const prepare = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn());
const fromForm = vi.hoisted(() => vi.fn());

vi.mock("cloudflare:workers", () => ({ env: { AI: { run: vi.fn() }, BETTER_AUTH_SECRET: "test-secret", BETTER_AUTH_URL: "https://app.example.test", AUTH_TRUSTED_ORIGINS: "" } }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/request-session", () => ({ requireSessionUser: async () => state.user }));
vi.mock("@/lib/viewer", () => ({ resolveViewer: async () => ({ owner: { id: "biz_owner-a" }, contractorOf: [] }) }));
vi.mock("@/lib/owner-assistant-ai", () => ({ planOwnerAssistantTurn: plan }));
vi.mock("@/services/owner-assistant", () => ({
  prepareOwnerAssistantResponse: prepare,
  confirmOwnerAssistantAction: confirm,
  ownerAssistantPlanFromForm: fromForm,
}));

import { POST as confirmAction } from "../src/app/api/owner-assistant/confirm/route";
import { POST as turn } from "../src/app/api/owner-assistant/turn/route";

function request(path: string, body: unknown) {
  const payload = JSON.stringify(body);
  return new Request(`https://app.example.test${path}`, { method: "POST", headers: { "content-type": "application/json", "content-length": String(payload.length), origin: "https://app.example.test" }, body: payload });
}

describe("owner assistant routes", () => {
  beforeEach(() => {
    state.user = { id: "owner-a", email: "owner@example.test", name: "Owner" };
    plan.mockReset(); prepare.mockReset(); confirm.mockReset(); fromForm.mockReset();
  });

  it("requires an authenticated owner session", async () => {
    state.user = null;
    const response = await turn(request("/api/owner-assistant/turn", { message: "Create a site", history: [] }));
    expect(response.status).toBe(401);
    expect(plan).not.toHaveBeenCalled();
  });

  it("passes bounded input and the session user to the planner and verifier", async () => {
    plan.mockResolvedValue({ intent: "clarify", reply: "Which site?" });
    prepare.mockResolvedValue({ kind: "message", message: "Which site?" });
    const response = await turn(request("/api/owner-assistant/turn", { message: "Create a site", history: [] }));
    expect(response.status).toBe(200);
    expect(plan).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "owner-a" }), expect.objectContaining({ intent: "clarify" }), "test-secret");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects invalid input before invoking AI", async () => {
    const response = await turn(request("/api/owner-assistant/turn", { message: "x".repeat(501), history: [] }));
    expect(response.status).toBe(400);
    expect(plan).not.toHaveBeenCalled();
  });

  it("uses a validated guided form without asking AI to reinterpret owner input", async () => {
    const form = { operation: "create_site", name: "Harbour", address: "1 Quay Street" };
    const guidedPlan = { intent: "create_site", reply: "I prepared the site.", name: "Harbour", address: "1 Quay Street" };
    fromForm.mockReturnValue(guidedPlan);
    prepare.mockResolvedValue({ kind: "preview", message: "I prepared the site.", confirmation: { action: "create_site", token: "token", expiresAt: "2026-11-02T12:00:00.000Z", title: "Create site Harbour?", details: [{ label: "Name", value: "Harbour" }] } });

    const response = await turn(request("/api/owner-assistant/turn", { message: "Review site details", history: [], form }));

    expect(response.status).toBe(200);
    expect(fromForm).toHaveBeenCalledWith(form);
    expect(plan).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "owner-a" }), guidedPlan, "test-secret");
  });

  it("confirms using the authenticated owner, never a client-supplied owner id", async () => {
    confirm.mockResolvedValue({ kind: "receipt", message: "Site created.", action: "create_site", targetId: "site-a" });
    const response = await confirmAction(request("/api/owner-assistant/confirm", { token: "signed-token", ownerUserId: "owner-b" }));
    expect(response.status).toBe(400);
    expect(confirm).not.toHaveBeenCalled();
    const allowed = await confirmAction(request("/api/owner-assistant/confirm", { token: "signed-token" }));
    expect(allowed.status).toBe(200);
    expect(confirm).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "owner-a" }), "signed-token", "test-secret");
  });
});
