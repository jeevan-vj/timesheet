import { describe, expect, it, vi } from "vitest";
import { waitForEmptyDashboard } from "../.factory/e2e/harness.mjs";

function fixture({ missing, status = 200, body = { business: null } } = {}) {
  const visible = (name) => ({ waitFor: vi.fn(async () => {
    if (name === missing) throw new Error("required UI missing");
  }) });
  return {
    getByRole: (_role, { name }) => visible(name),
    getByText: visible,
    response: { status: () => status, json: async () => body },
  };
}

describe("Factory empty-dashboard readiness", () => {
  it("accepts the rendered new-owner dashboard with an authenticated API response", async () => {
    const page = fixture();
    await expect(waitForEmptyDashboard(page, page.response)).resolves.toBeUndefined();
  });
  it.each(["Hours & contractor pay", "Add your business", "No shifts this week"])(
    "rejects missing required UI: %s", async (missing) => {
      const page = fixture({ missing });
      await expect(waitForEmptyDashboard(page, page.response))
        .rejects.toThrow("required UI missing");
    },
  );
  it.each([
    { status: 401 },
    { status: 500 },
    { body: {} },
    { body: { business: { id: "unexpected" } } },
  ])("rejects an unauthenticated, failed, or nonempty workspace response: %j", async (options) => {
    const page = fixture(options);
    await expect(waitForEmptyDashboard(page, page.response))
      .rejects.toThrow("empty dashboard check failed");
  });
});
