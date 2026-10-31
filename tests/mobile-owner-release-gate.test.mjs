import { describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ send: vi.fn(), invalidate: vi.fn() }));
vi.mock("../apps/mobile/src/api", () => ({ mobileFetch: io.send }));
vi.mock("../apps/mobile/src/owner-api", () => ({ OWNER_DASHBOARD_QUERY: "owner-dashboard" }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: io.invalidate }),
  useMutation: (options) => options,
}));

import { useOwnerShiftException } from "../apps/mobile/src/owner-mutations-client";

describe("mobile owner release gate", () => {
  it.each(["worked", "did_not_work", "reset_pending", "change_hours"])(
    "sends %s and refreshes the owner dashboard after success",
    async (action) => {
      io.send.mockResolvedValueOnce({ status: 200, json: async () => ({ ok: true }) });
      const options = useOwnerShiftException();
      await expect(options.mutationFn({ entryId: "synthetic_1", action, paidMinutes: 75 }))
        .resolves.toEqual({ ok: true });
      expect(io.send).toHaveBeenCalledTimes(1);
      await options.onSuccess();
      expect(io.invalidate).toHaveBeenCalledWith({ queryKey: ["owner-dashboard"] });
      io.send.mockClear();
      io.invalidate.mockClear();
    },
  );
});
