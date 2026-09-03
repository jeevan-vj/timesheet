import { describe, expect, it } from "vitest";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { calculateEntryPayCents, summarizeWeek } from "../src/lib/payroll";
import {
  assertRemittanceTotals,
  buildRemittanceModel,
  remittanceFilename,
  remittanceFilenameSlug,
  remittanceMoney,
  remittanceReference,
  renderRemittancePdf,
  type RemittanceEntryInput,
  type RemittanceModel,
} from "../src/lib/remittance";

const weekStart = "2026-08-31";
const weekEnd = "2026-09-06";
const contractorId = "c-aroha";
const contractorName = "Aroha";
const currentDefaultRateCents = 4_500;

const twoRateEntries: RemittanceEntryInput[] = [
  {
    id: "e-warehouse",
    workDate: "2026-09-02",
    siteName: "Warehouse",
    paidMinutes: 90,
    rateCents: 2_800,
    contractorId,
    contractorName,
  },
  {
    id: "e-harbour",
    workDate: "2026-08-31",
    siteName: "Harbour Offices",
    paidMinutes: 480,
    rateCents: 3_200,
    contractorId,
    contractorName,
  },
];

function snapshotPayCents(entries: RemittanceEntryInput[]) {
  return entries.reduce((sum, entry) => sum + calculateEntryPayCents(entry.paidMinutes, entry.rateCents), 0);
}

function naiveCurrentRatePayCents(entries: RemittanceEntryInput[], rateCents: number) {
  return calculateEntryPayCents(entries.reduce((sum, entry) => sum + entry.paidMinutes, 0), rateCents);
}

function modelFrom(entries = twoRateEntries): RemittanceModel {
  return buildRemittanceModel({
    contractorId,
    contractorName,
    weekStart,
    weekEnd,
    remitterName: "Owner One",
    remitterEmail: "owner@example.test",
    entries,
  });
}

function stringsFromContent(raw: string): string[] {
  const parts: string[] = [];
  for (const match of raw.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
    parts.push(match[0].slice(1, -1).replace(/\\n/g, "\n").replace(/\\(.)/g, "$1"));
  }
  for (const match of raw.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
    const hex = match[1].replace(/\s/g, "");
    if (hex.length < 2 || hex.length % 2 !== 0) continue;
    const chars: string[] = [];
    for (let i = 0; i < hex.length; i += 2) {
      chars.push(String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16)));
    }
    parts.push(chars.join(""));
  }
  return parts;
}

function decodeContentStream(stream: PDFRawStream): string {
  return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
}

async function extractVisiblePdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const parts: string[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    if (!contents) continue;
    const streams = contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, index) => contents.lookup(index))
      : [contents];
    for (const stream of streams) {
      if (stream instanceof PDFRawStream) parts.push(...stringsFromContent(decodeContentStream(stream)));
    }
  }
  return parts.join("\n");
}

describe("remittance filename and reference", () => {
  it("builds a stable reference and ASCII filename slug", () => {
    expect(remittanceReference(contractorId, weekStart)).toBe("RA-c-aroha-2026-08-31");
    expect(remittanceFilenameSlug("Aroha")).toBe("aroha");
    expect(remittanceFilenameSlug("Aroha K.")).toBe("aroha-k");
    expect(remittanceFilenameSlug("Clean--Track!!Team")).toBe("clean-track-team");
    expect(remittanceFilenameSlug("  ***  ")).toBe("contractor");
    expect(remittanceFilenameSlug("")).toBe("contractor");
    expect(remittanceFilename("Aroha K.", weekEnd)).toBe("remittance-aroha-k-2026-09-06.pdf");
  });
});

describe("remittance model", () => {
  it("orders lines and totals from snapshotted rates, not current contractor rates", () => {
    const naive = naiveCurrentRatePayCents(twoRateEntries, currentDefaultRateCents);
    const snapshot = snapshotPayCents(twoRateEntries);
    const summary = summarizeWeek(twoRateEntries);
    expect(summary).toHaveLength(1);
    expect(summary[0]?.payCents).toBe(snapshot);
    expect(snapshot).not.toBe(naive);
    expect(snapshot).toBe(calculateEntryPayCents(480, 3_200) + calculateEntryPayCents(90, 2_800));

    const model = modelFrom();
    expect(model.reference).toBe("RA-c-aroha-2026-08-31");
    expect(model.filename).toBe("remittance-aroha-2026-09-06.pdf");
    expect(model.payCents).toBe(snapshot);
    expect(model.paidMinutes).toBe(570);
    expect(model.lines.map((line) => line.siteName)).toEqual(["Harbour Offices", "Warehouse"]);
    expect(model.lines.map((line) => line.payCents)).toEqual([
      calculateEntryPayCents(480, 3_200),
      calculateEntryPayCents(90, 2_800),
    ]);
    expect(model.lines.reduce((sum, line) => sum + line.payCents, 0)).toBe(model.payCents);
  });

  it("returns an equal model for the same fixtures twice", () => {
    expect(modelFrom()).toEqual(modelFrom([...twoRateEntries].reverse()));
  });

  it("refuses to render when line totals do not match the weekly summary", async () => {
    const tampered = { ...modelFrom(), payCents: 1 };
    expect(() => assertRemittanceTotals(tampered)).toThrow("invalid_request");
    await expect(renderRemittancePdf(tampered)).rejects.toThrow("invalid_request");
  });

  it("includes absence lines as 0h/$0 and still builds a model", () => {
    const entries: RemittanceEntryInput[] = [
      {
        id: "e-absent",
        workDate: "2026-08-31",
        siteName: "Harbour Offices",
        paidMinutes: 0,
        rateCents: 2_000,
        contractorId,
        contractorName,
      },
      {
        id: "e-worked",
        workDate: "2026-09-01",
        siteName: "Harbour Offices",
        paidMinutes: 90,
        rateCents: 2_000,
        contractorId,
        contractorName,
      },
    ];
    const model = buildRemittanceModel({
      contractorId,
      contractorName,
      weekStart,
      weekEnd,
      remitterName: "Owner One",
      remitterEmail: "owner@example.test",
      entries,
    });
    expect(model.lines[0]).toMatchObject({ paidMinutes: 0, payCents: 0, rateCents: 2_000 });
    expect(model.lines[1]?.payCents).toBe(calculateEntryPayCents(90, 2_000));
    expect(model.paidMinutes).toBe(90);
    expect(model.payCents).toBe(calculateEntryPayCents(90, 2_000));
  });

  it("builds a PDF for an absence-only week instead of treating it as empty", async () => {
    const model = buildRemittanceModel({
      contractorId,
      contractorName,
      weekStart,
      weekEnd,
      remitterName: "Owner One",
      remitterEmail: "owner@example.test",
      entries: [{
        id: "e-absent",
        workDate: "2026-08-31",
        siteName: "Harbour Offices",
        paidMinutes: 0,
        rateCents: 2_000,
        contractorId,
        contractorName,
      }],
    });
    expect(model.paidMinutes).toBe(0);
    expect(model.payCents).toBe(0);
    expect(model.lines).toHaveLength(1);
    expect(model.lines[0]?.payCents).toBe(0);
    const pdf = await renderRemittancePdf(model);
    expect(Buffer.from(pdf.subarray(0, 4)).toString("utf8")).toBe("%PDF");
  });
});

describe("remittance PDF", () => {
  it("starts with %PDF and includes the required visible strings", async () => {
    const model = modelFrom();
    const pdf = await renderRemittancePdf(model);
    expect(Buffer.from(pdf.subarray(0, 4)).toString("utf8")).toBe("%PDF");
    const visible = await extractVisiblePdfText(pdf);
    const total = remittanceMoney(model.payCents);
    expect(visible).toContain("Remittance Advice");
    expect(visible).toContain(contractorName);
    expect(visible).toContain(contractorId);
    expect(visible).toContain(weekStart);
    expect(visible).toContain(weekEnd);
    expect(visible).toContain(model.reference);
    expect(visible).toContain(total);
    expect(visible).not.toMatch(/generated[- ]at/i);
    expect(visible).not.toMatch(/payment date/i);
    expect(visible).not.toMatch(/remittance date/i);
    expect(visible).not.toMatch(/created at/i);
    expect(visible).not.toMatch(/date issued/i);
  });
});
