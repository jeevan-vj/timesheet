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
    "rejects %s before transport or cache invalidation",
    async (action) => {
      // Only the React Query adapter is replaced; the real mutation function and gate run.
      const options = useOwnerShiftException();
      await expect(options.mutationFn({ entryId: "synthetic_1", action, paidMinutes: 75 }))
        .rejects.toThrow(/pending audit history and release review/i);
      expect(io.send).not.toHaveBeenCalled();
      expect(io.invalidate).not.toHaveBeenCalled();
    },
  );
});
