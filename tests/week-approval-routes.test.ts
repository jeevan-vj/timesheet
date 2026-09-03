import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  user: { id: "owner-1", email: "owner@example.test", name: "Owner" } as { id: string; email: string; name: string } | null,
}));

const weekApproval = vi.hoisted(() => ({
  approveWeek: vi.fn(),
  reopenWeek: vi.fn(),
}));

const db = vi.hoisted(() => ({ tag: "mock-db" }));

vi.mock("cloudflare:workers", () => ({
  env: {
    DB: { prepare: vi.fn() },
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "https://app.example.test",
    AUTH_TRUSTED_ORIGINS: "",
  },
}));
vi.mock("@/db/client", () => ({ db }));
vi.mock("@/lib/request-session", () => ({
  requireSessionUser: async () => session.user,
}));
vi.mock("@/lib/runtime-env", () => ({
  getTrustedOrigins: () => ["https://app.example.test"],
  getSecureCookies: () => true,
}));
vi.mock("@/services/week-approval", () => weekApproval);

import { POST as approveWeek } from "../src/app/api/weeks/[weekStart]/approve/route";
import { POST as reopenWeek } from "../src/app/api/weeks/[weekStart]/reopen/route";

const approval = {
  status: "approved" as const,
  approvedAt: "2026-09-03T00:00:00.000Z",
  reopenedAt: null,
};

const weekParams = (weekStart: string) => ({ params: Promise.resolve({ weekStart }) });

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  const encoded = JSON.stringify(body);
  return new Request(url, {
    method: "POST",
    body: encoded,
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(encoded)),
      cookie: "better-auth.session_token=test",
      origin: "https://app.example.test",
      ...headers,
    },
  });
}

describe("week approval routes", () => {
  beforeEach(() => {
    session.user = { id: "owner-1", email: "owner@example.test", name: "Owner" };
    weekApproval.approveWeek.mockReset();
    weekApproval.reopenWeek.mockReset();
  });

  it("rejects cookie mutations from an untrusted origin", async () => {
    const request = jsonRequest("https://app.example.test/api/weeks/2026-08-31/approve", {
      expectedPaidMinutes: 480,
      expectedPayCents: 25_600,
    }, { origin: "https://evil.example" });
    const response = await approveWeek(request, weekParams("2026-08-31"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(weekApproval.approveWeek).not.toHaveBeenCalled();

    const reopen = await reopenWeek(jsonRequest("https://app.example.test/api/weeks/2026-08-31/reopen", {
      expectedPaidMinutes: 480,
      expectedPayCents: 25_600,
    }, { origin: "https://evil.example" }), weekParams("2026-08-31"));
    expect(reopen.status).toBe(403);
    expect(await reopen.json()).toEqual({ error: "forbidden" });
    expect(weekApproval.reopenWeek).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated approve and reopen", async () => {
    session.user = null;
    const approved = await approveWeek(jsonRequest("https://app.example.test/api/weeks/2026-08-31/approve", {
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    }), weekParams("2026-08-31"));
    expect(approved.status).toBe(401);
    expect(await approved.json()).toEqual({ error: "unauthorized" });

    const reopened = await reopenWeek(jsonRequest("https://app.example.test/api/weeks/2026-08-31/reopen", {
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    }), weekParams("2026-08-31"));
    expect(reopened.status).toBe(401);
    expect(await reopened.json()).toEqual({ error: "unauthorized" });
    expect(weekApproval.approveWeek).not.toHaveBeenCalled();
    expect(weekApproval.reopenWeek).not.toHaveBeenCalled();
  });

  it("rejects a non-Monday week path before calling the service", async () => {
    const response = await approveWeek(jsonRequest("https://app.example.test/api/weeks/2026-09-02/approve", {
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    }), weekParams("2026-09-02"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_week" });
    expect(weekApproval.approveWeek).not.toHaveBeenCalled();

    const reopen = await reopenWeek(jsonRequest("https://app.example.test/api/weeks/not-a-week/reopen", {
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    }), weekParams("not-a-week"));
    expect(reopen.status).toBe(400);
    expect(await reopen.json()).toEqual({ error: "invalid_week" });
  });

  it("derives owner from the session and returns only the approval resource", async () => {
    weekApproval.approveWeek.mockResolvedValue(approval);
    const response = await approveWeek(jsonRequest("https://app.example.test/api/weeks/2026-08-31/approve", {
      expectedPaidMinutes: 480,
      expectedPayCents: 25_600,
      ownerUserId: "forged-owner",
      owner_user_id: "forged-owner",
    }), weekParams("2026-08-31"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(approval);
    expect(weekApproval.approveWeek).toHaveBeenCalledWith(db, "owner-1", "2026-08-31", {
      expectedPaidMinutes: 480,
      expectedPayCents: 25_600,
    });

    weekApproval.reopenWeek.mockResolvedValue({ status: "open", approvedAt: approval.approvedAt, reopenedAt: "2026-09-04T00:00:00.000Z" });
    const reopened = await reopenWeek(jsonRequest("https://app.example.test/api/weeks/2026-08-31/reopen", {
      expectedPaidMinutes: 480,
      expectedPayCents: 25_600,
    }), weekParams("2026-08-31"));
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toEqual({
      status: "open",
      approvedAt: approval.approvedAt,
      reopenedAt: "2026-09-04T00:00:00.000Z",
    });
    expect(weekApproval.reopenWeek).toHaveBeenCalledWith(db, "owner-1", "2026-08-31", {
      expectedPaidMinutes: 480,
      expectedPayCents: 25_600,
    });
  });

  it("maps week approval conflicts to 409", async () => {
    weekApproval.approveWeek.mockRejectedValue(new Error("week_already_approved"));
    const already = await approveWeek(jsonRequest("https://app.example.test/api/weeks/2026-08-31/approve", {
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    }), weekParams("2026-08-31"));
    expect(already.status).toBe(409);
    expect(await already.json()).toEqual({ error: "week_already_approved" });

    weekApproval.approveWeek.mockRejectedValue(new Error("stale_week_totals"));
    const stale = await approveWeek(jsonRequest("https://app.example.test/api/weeks/2026-08-31/approve", {
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    }), weekParams("2026-08-31"));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "stale_week_totals" });

    weekApproval.reopenWeek.mockRejectedValue(new Error("week_not_approved"));
    const notApproved = await reopenWeek(jsonRequest("https://app.example.test/api/weeks/2026-08-31/reopen", {
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    }), weekParams("2026-08-31"));
    expect(notApproved.status).toBe(409);
    expect(await notApproved.json()).toEqual({ error: "week_not_approved" });

    weekApproval.reopenWeek.mockRejectedValue(new Error("week_locked"));
    const locked = await reopenWeek(jsonRequest("https://app.example.test/api/weeks/2026-08-31/reopen", {
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    }), weekParams("2026-08-31"));
    expect(locked.status).toBe(409);
    expect(await locked.json()).toEqual({ error: "week_locked" });
  });

  it("maps malformed totals to 400 and keeps existing apiError statuses", async () => {
    const invalid = await approveWeek(jsonRequest("https://app.example.test/api/weeks/2026-08-31/approve", {
      expectedPaidMinutes: -1,
      expectedPayCents: 0,
    }), weekParams("2026-08-31"));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_request" });
    expect(weekApproval.approveWeek).not.toHaveBeenCalled();

    weekApproval.approveWeek.mockRejectedValue(new Error("not_found"));
    const missing = await approveWeek(jsonRequest("https://app.example.test/api/weeks/2026-08-31/approve", {
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    }), weekParams("2026-08-31"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });

    weekApproval.approveWeek.mockRejectedValue(new Error("duplicate_contractor"));
    const duplicate = await approveWeek(jsonRequest("https://app.example.test/api/weeks/2026-08-31/approve", {
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    }), weekParams("2026-08-31"));
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "duplicate_contractor" });
  });
});
