import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { calculateEntryPayCents, summarizeWeek, weekEnd } from "@/lib/payroll";

export const REMITTANCE_GROSS_DISCLAIMER = "Gross contractor payments before tax, GST, expenses, or adjustments.";

export type RemittanceEntryInput = {
  id: string;
  workDate: string;
  siteName: string;
  paidMinutes: number;
  rateCents: number;
  contractorId: string;
  contractorName: string;
};

export type RemittanceLine = {
  workDate: string;
  siteName: string;
  paidMinutes: number;
  rateCents: number;
  payCents: number;
};

export type RemittanceModel = {
  reference: string;
  filename: string;
  contractorId: string;
  contractorName: string;
  weekStart: string;
  weekEnd: string;
  remitterName: string;
  remitterEmail: string;
  currency: "NZD";
  lines: RemittanceLine[];
  paidMinutes: number;
  payCents: number;
  disclaimer: string;
};

export type RemittanceModelInput = {
  contractorId: string;
  contractorName: string;
  weekStart: string;
  weekEnd: string;
  remitterName: string;
  remitterEmail: string;
  entries: RemittanceEntryInput[];
};

const moneyFormat = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
const ink = rgb(0.12, 0.16, 0.22);
const muted = rgb(0.35, 0.4, 0.45);

export function remittanceReference(contractorId: string, weekStart: string): string {
  return `RA-${contractorId}-${weekStart}`;
}

export function remittanceFilenameSlug(contractorName: string): string {
  const slug = contractorName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "contractor";
}

export function remittanceFilename(contractorName: string, weekEndDate: string): string {
  return `remittance-${remittanceFilenameSlug(contractorName)}-${weekEndDate}.pdf`;
}

export function remittanceMoney(cents: number): string {
  return moneyFormat.format(cents / 100);
}

export function remittanceDate(value: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-NZ", options).format(new Date(`${value}T00:00:00Z`));
}

export function remittanceDuration(paidMinutes: number): string {
  const hours = Math.floor(paidMinutes / 60);
  const remainder = paidMinutes % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function sortEntries(entries: RemittanceEntryInput[]): RemittanceEntryInput[] {
  return [...entries].sort((a, b) => {
    const byDate = a.workDate.localeCompare(b.workDate);
    if (byDate !== 0) return byDate;
    const bySite = a.siteName.localeCompare(b.siteName);
    if (bySite !== 0) return bySite;
    return a.id.localeCompare(b.id);
  });
}

export function assertRemittanceTotals(model: RemittanceModel): void {
  const linePay = model.lines.reduce((sum, line) => sum + line.payCents, 0);
  const lineMinutes = model.lines.reduce((sum, line) => sum + line.paidMinutes, 0);
  if (linePay !== model.payCents || lineMinutes !== model.paidMinutes) {
    throw new Error("invalid_request");
  }
}

export function buildRemittanceModel(input: RemittanceModelInput): RemittanceModel {
  if (input.weekEnd !== weekEnd(input.weekStart)) throw new Error("invalid_week_start");
  const ordered = sortEntries(input.entries);
  const groups = summarizeWeek(ordered.map((entry) => ({
    contractorId: entry.contractorId,
    contractorName: entry.contractorName,
    paidMinutes: entry.paidMinutes,
    rateCents: entry.rateCents,
  })));
  if (groups.length !== 1) throw new Error("invalid_request");
  const summary = groups[0];
  if (!summary) throw new Error("invalid_request");
  const lines = ordered.map((entry) => ({
    workDate: entry.workDate,
    siteName: entry.siteName,
    paidMinutes: entry.paidMinutes,
    rateCents: entry.rateCents,
    payCents: calculateEntryPayCents(entry.paidMinutes, entry.rateCents),
  }));
  const model: RemittanceModel = {
    reference: remittanceReference(input.contractorId, input.weekStart),
    filename: remittanceFilename(input.contractorName, input.weekEnd),
    contractorId: input.contractorId,
    contractorName: input.contractorName,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    remitterName: input.remitterName,
    remitterEmail: input.remitterEmail,
    currency: "NZD",
    lines,
    paidMinutes: summary.paidMinutes,
    payCents: summary.payCents,
    disclaimer: REMITTANCE_GROSS_DISCLAIMER,
  };
  assertRemittanceTotals(model);
  return model;
}

function requireWinAnsi(font: PDFFont, value: string): void {
  font.encodeText(value);
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  if (text === "") return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  const flush = () => {
    if (current) {
      lines.push(current);
      current = "";
    }
  };
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    flush();
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }
    let chunk = "";
    for (const char of word) {
      const next = chunk + char;
      if (chunk && font.widthOfTextAtSize(next, size) > maxWidth) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk = next;
      }
    }
    current = chunk;
  }
  flush();
  return lines.length ? lines : [""];
}

function drawText(page: PDFPage, font: PDFFont, text: string, x: number, y: number, size: number, color = ink): void {
  requireWinAnsi(font, text);
  page.drawText(text, { x, y, size, font, color });
}

function drawRight(page: PDFPage, font: PDFFont, text: string, right: number, y: number, size: number, color = ink): void {
  requireWinAnsi(font, text);
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: right - width, y, size, font, color });
}

export async function renderRemittancePdf(model: RemittanceModel): Promise<Uint8Array> {
  assertRemittanceTotals(model);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [pageWidth, pageHeight] = PageSizes.A4;
  const margin = 48;
  const bodySize = 10;
  const smallSize = 9;
  const lineHeight = 13;
  const usableRight = pageWidth - margin;

  let page = pdf.addPage(PageSizes.A4);
  let y = pageHeight - margin;

  const ensure = (needed: number, withTableHeader = false) => {
    if (y - needed >= margin) return;
    page = pdf.addPage(PageSizes.A4);
    y = pageHeight - margin;
    if (withTableHeader) drawTableHeader();
  };

  const cols = {
    date: { x: margin, right: margin + 88 },
    site: { x: margin + 92, right: margin + 268 },
    paid: { x: margin + 272, right: margin + 338 },
    rate: { x: margin + 342, right: margin + 432 },
    pay: { x: margin + 436, right: usableRight },
  };

  function drawTableHeader() {
    drawText(page, bold, "Date", cols.date.x, y, smallSize, muted);
    drawText(page, bold, "Site", cols.site.x, y, smallSize, muted);
    drawRight(page, bold, "Paid", cols.paid.right, y, smallSize, muted);
    drawRight(page, bold, "Rate", cols.rate.right, y, smallSize, muted);
    drawRight(page, bold, "Pay", cols.pay.right, y, smallSize, muted);
    y -= 8;
    page.drawLine({
      start: { x: margin, y },
      end: { x: usableRight, y },
      thickness: 0.6,
      color: rgb(0.78, 0.8, 0.82),
    });
    y -= lineHeight;
  }

  drawText(page, bold, "Remittance Advice", margin, y, 18);
  y -= 28;

  const meta = [
    ["Remitter", `${model.remitterName}  ${model.remitterEmail}`],
    ["Contractor", model.contractorName],
    ["Contractor ID", model.contractorId],
    ["Week (Monday–Sunday)", `${model.weekStart} – ${model.weekEnd}`],
    ["Reference", model.reference],
  ];
  for (const [label, value] of meta) {
    ensure(lineHeight * 2);
    drawText(page, bold, label, margin, y, smallSize, muted);
    y -= lineHeight;
    const wrapped = wrapText(font, value, bodySize, usableRight - margin);
    for (const line of wrapped) {
      ensure(lineHeight);
      drawText(page, font, line, margin, y, bodySize);
      y -= lineHeight;
    }
    y -= 4;
  }

  y -= 8;
  ensure(lineHeight * 2);
  drawTableHeader();

  for (const line of model.lines) {
    const dateText = remittanceDate(line.workDate, { day: "numeric", month: "short", year: "numeric" });
    const siteLines = wrapText(font, line.siteName, smallSize, cols.site.right - cols.site.x);
    const paidText = remittanceDuration(line.paidMinutes);
    const rateText = `${remittanceMoney(line.rateCents)}/hr`;
    const payText = remittanceMoney(line.payCents);
    const rowHeight = Math.max(siteLines.length, 1) * lineHeight + 4;
    ensure(rowHeight, true);
    drawText(page, font, dateText, cols.date.x, y, smallSize);
    drawRight(page, font, paidText, cols.paid.right, y, smallSize);
    drawRight(page, font, rateText, cols.rate.right, y, smallSize);
    drawRight(page, font, payText, cols.pay.right, y, smallSize);
    let siteY = y;
    for (const siteLine of siteLines) {
      drawText(page, font, siteLine, cols.site.x, siteY, smallSize);
      siteY -= lineHeight;
    }
    y -= rowHeight;
  }

  y -= 6;
  ensure(lineHeight * 2);
  page.drawLine({
    start: { x: margin, y: y + 8 },
    end: { x: usableRight, y: y + 8 },
    thickness: 0.6,
    color: rgb(0.78, 0.8, 0.82),
  });
  drawText(page, bold, "Total payable", margin, y, bodySize);
  drawRight(page, bold, remittanceMoney(model.payCents), usableRight, y, bodySize);
  y -= lineHeight * 2;

  const disclaimerLines = wrapText(font, model.disclaimer, smallSize, usableRight - margin);
  for (const line of disclaimerLines) {
    ensure(lineHeight);
    drawText(page, font, line, margin, y, smallSize, muted);
    y -= lineHeight;
  }

  return pdf.save();
}
