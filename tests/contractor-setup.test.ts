import { describe, expect, it, vi } from "vitest";
import { shiftEntryBlocker } from "../src/lib/shift-entry";
import {
  cancelContractorArchive,
  contractorArchivePrompt,
  contractorArchiveRequest,
  contractorErrorCopy,
  contractorFormPayload,
  contractorRestoreRequest,
  contractorsListUrl,
  createContractorArchiveFlow,
  emptyContractorForm,
  emptyContractorsCopy,
  firstInvalidField,
  idleContractorArchive,
  rateDollarsFromCents,
  requestContractorArchive,
  shiftEntryContractorOptions,
  visibleContractors,
} from "../src/lib/contractor-setup";

const aroha = {
  id: "c1",
  name: "Aroha",
  email: "a@example.test",
  phone: "021000000",
  defaultRateCents: 3_200,
  currency: "NZD" as const,
  active: true,
  preferredName: "",
  startDate: null,
  engagementStatus: "active" as const,
  gstRegistered: false,
  gstNumber: "",
  internalNotes: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

const archivedSam = {
  ...aroha,
  id: "c2",
  name: "Archived Sam",
  email: "",
  phone: "",
  defaultRateCents: 2_800,
  active: false,
  engagementStatus: "archived" as const,
};

const suspendedMoana = {
  ...aroha,
  id: "c3",
  name: "Moana",
  active: false,
  engagementStatus: "suspended" as const,
};

const target = { id: "c1", name: "Aroha" };

describe("contractor archive confirmation", () => {
  it("identifies the contractor name before any request", () => {
    const session = requestContractorArchive(target);
    const prompt = contractorArchivePrompt(session.target);

    expect(session).toEqual({ phase: "confirming", target });
    expect(prompt.title).toBe("Archive this contractor?");
    expect(prompt.description).toContain("Aroha");
    expect(prompt.confirmLabel).toBe("Archive contractor");
    expect(prompt.cancelLabel).toBe("Cancel");
    expect(prompt.closeLabel).toBe("Close archive confirmation");
  });

  it("cancel and close return to idle without sending an archive request", async () => {
    const sendArchive = vi.fn();
    const flow = createContractorArchiveFlow(sendArchive);
    flow.request(target);
    flow.cancel();
    await flow.confirm();

    expect(flow.getSession()).toEqual(idleContractorArchive);
    expect(cancelContractorArchive()).toEqual(idleContractorArchive);
    expect(sendArchive).not.toHaveBeenCalled();
  });

  it("confirm sends one POST /api/contractors/:id/archive and no JSON body", async () => {
    const sendArchive = vi.fn(async () => undefined);
    const flow = createContractorArchiveFlow(sendArchive);
    flow.request(target);
    expect(contractorArchiveRequest(target)).toEqual({ method: "POST", url: "/api/contractors/c1/archive" });
    expect(contractorArchiveRequest(target)).not.toHaveProperty("body");

    await flow.confirm();

    expect(sendArchive).toHaveBeenCalledTimes(1);
    expect(sendArchive).toHaveBeenCalledWith({ method: "POST", url: "/api/contractors/c1/archive" });
    expect(flow.getSession()).toEqual(idleContractorArchive);
  });

  it("ignores a second confirm while the first archive is in flight", async () => {
    let finish!: () => void;
    const sendArchive = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const flow = createContractorArchiveFlow(sendArchive);
    flow.request(target);

    const first = flow.confirm();
    expect(flow.getSession().phase).toBe("submitting");
    const second = flow.confirm();
    flow.cancel();
    finish();
    await Promise.all([first, second]);

    expect(sendArchive).toHaveBeenCalledTimes(1);
    expect(flow.getSession()).toEqual(idleContractorArchive);
  });
});

describe("contractor restore request", () => {
  it("is POST /api/contractors/:id/restore with no body", () => {
    const request = contractorRestoreRequest("c2");
    expect(request).toEqual({ method: "POST", url: "/api/contractors/c2/restore" });
    expect(request).not.toHaveProperty("body");
  });
});

describe("contractor list helper", () => {
  it("shows every status except archived by default", () => {
    expect(visibleContractors([aroha, archivedSam, suspendedMoana], false).map((row) => row.id)).toEqual(["c1", "c3"]);
    expect(visibleContractors([aroha, archivedSam, suspendedMoana], true).map((row) => row.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("requests includeArchived only when the toggle is on", () => {
    expect(contractorsListUrl(false)).toBe("/api/contractors");
    expect(contractorsListUrl(true)).toBe("/api/contractors?includeArchived=true");
    expect(emptyContractorsCopy(false)).toBe("No contractors yet");
    expect(emptyContractorsCopy(true)).toBe("No archived contractors.");
  });
});

describe("contractor form payload", () => {
  it("trims the name and converts dollars to integer cents", () => {
    const result = contractorFormPayload({
      ...emptyContractorForm(),
      name: "  Aroha  ",
      email: " a@example.test ",
      phone: " 021000000 ",
      rateDollars: "32.5",
    });
    expect(result).toEqual({
      ok: true,
      payload: {
        name: "Aroha",
        email: "a@example.test",
        phone: "021000000",
        defaultRateCents: 3_250,
        preferredName: "",
        startDate: null,
        engagementStatus: "active",
        gstRegistered: false,
        gstNumber: "",
        internalNotes: "",
        emergencyContactName: "",
        emergencyContactPhone: "",
      },
    });
    if (result.ok) {
      expect(result.payload).not.toHaveProperty("ownerUserId");
      expect(Number.isInteger(result.payload.defaultRateCents)).toBe(true);
    }
  });

  it("rejects fractional and out-of-range rates", () => {
    const fractional = contractorFormPayload({ ...emptyContractorForm(), name: "Aroha", rateDollars: "32.555" });
    expect(fractional.ok).toBe(false);
    if (!fractional.ok) {
      expect(fractional.fields.defaultRateCents).toBe("Default hourly rate must be a whole number of cents between 1500 and 25000 (NZ$15–NZ$250).");
    }

    const tooLow = contractorFormPayload({ ...emptyContractorForm(), name: "Aroha", rateDollars: "14.99" });
    expect(tooLow.ok).toBe(false);
    if (!tooLow.ok) expect(tooLow.fields.defaultRateCents).toBeDefined();

    const tooHigh = contractorFormPayload({ ...emptyContractorForm(), name: "Aroha", rateDollars: "250.01" });
    expect(tooHigh.ok).toBe(false);
    if (!tooHigh.ok) expect(tooHigh.fields.defaultRateCents).toBeDefined();
  });

  it("rejects a blank name after trim and formats cents back to dollars for the form", () => {
    const blank = contractorFormPayload({ ...emptyContractorForm(), name: "   ", rateDollars: "30" });
    expect(blank.ok).toBe(false);
    if (!blank.ok) {
      expect(blank.fields.name).toBe("Enter a name between 1 and 100 characters.");
      expect(firstInvalidField(blank.fields)).toBe("name");
    }
    expect(rateDollarsFromCents(3_200)).toBe("32.00");
    expect(rateDollarsFromCents(3_250)).toBe("32.50");
  });

  it("accepts engagement details and rejects an invalid GST number or start date", () => {
    const saved = contractorFormPayload({
      ...emptyContractorForm(),
      name: "Aroha",
      preferredName: " Ro ",
      startDate: "2026-08-03",
      engagementStatus: "suspended",
      gstRegistered: true,
      gstNumber: "123 456 789",
      internalNotes: "  Key holder  ",
      emergencyContactName: " Sam ",
      emergencyContactPhone: " 021111111 ",
    });
    expect(saved).toMatchObject({
      ok: true,
      payload: {
        preferredName: "Ro",
        startDate: "2026-08-03",
        engagementStatus: "suspended",
        gstRegistered: true,
        gstNumber: "123456789",
        internalNotes: "Key holder",
        emergencyContactName: "Sam",
        emergencyContactPhone: "021111111",
      },
    });

    const badGst = contractorFormPayload({ ...emptyContractorForm(), name: "Aroha", gstNumber: "12-345" });
    expect(badGst.ok).toBe(false);
    if (!badGst.ok) expect(badGst.fields.gstNumber).toMatch(/8 or 9 digits/);

    const badDate = contractorFormPayload({ ...emptyContractorForm(), name: "Aroha", startDate: "2026-02-31" });
    expect(badDate.ok).toBe(false);
    if (!badDate.ok) expect(badDate.fields.startDate).toBeDefined();
  });
});

describe("contractor error copy", () => {
  it("uses the same-owner duplicate copy without creating a second row", () => {
    const copy = contractorErrorCopy({ error: "duplicate_contractor" });
    expect(copy.message).toBe("A contractor with this name already exists. Restore the archived contractor or choose a different name.");
    expect(copy.fields).toEqual({});
  });

  it("surfaces field errors and generic request failures", () => {
    const fields = contractorErrorCopy({
      error: "invalid_request",
      fields: {
        name: "Enter a name between 1 and 100 characters.",
        email: "Enter a valid email or leave it blank.",
      },
    });
    expect(fields.fields.name).toBe("Enter a name between 1 and 100 characters.");
    expect(fields.fields.email).toBe("Enter a valid email or leave it blank.");
    expect(firstInvalidField(fields.fields)).toBe("name");

    expect(contractorErrorCopy({ error: "invalid_request" }).message).toMatch(/try again|check/i);
    expect(contractorErrorCopy({ error: "not_found" }).message).toMatch(/could not be found/i);
    expect(contractorErrorCopy({ error: "request_failed" }).message).toMatch(/try again/i);
  });
});

describe("archived contractors stay out of shift-entry options", () => {
  it("uses dashboard active-only contractors, so archived rows are not selectable", () => {
    const dashboard = {
      contractors: [{ id: "c1", name: "Aroha" }],
      sites: [{ id: "s1" }],
    };
    const options = shiftEntryContractorOptions(dashboard.contractors);
    expect(options.map((row) => row.id)).toEqual(["c1"]);
    expect(options.map((row) => row.id)).not.toContain(archivedSam.id);
    expect(shiftEntryBlocker(dashboard)).toBeNull();
    expect(shiftEntryBlocker({ contractors: [], sites: dashboard.sites })?.label).toBe("Add a contractor");
  });
});
