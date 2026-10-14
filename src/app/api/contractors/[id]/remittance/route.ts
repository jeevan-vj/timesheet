import { db } from "@/db/client";
import { apiError, authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { isValidContractorId } from "@/lib/contractor-lifecycle";
import { buildRemittanceModel, renderRemittancePdf } from "@/lib/remittance";
import { weekStartInput } from "@/lib/validation";
import { getContractorWeekRemittance } from "@/services/remittance";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!isValidContractorId(id)) return noStoreJson({ error: "invalid_request" }, 400);
  const week = new URL(request.url).searchParams.get("week") ?? "";
  const parsed = weekStartInput.safeParse(week);
  if (!parsed.success) return noStoreJson({ error: "invalid_week" }, 400);
  try {
    const data = await getContractorWeekRemittance(db, access.user.id, id, parsed.data);
    const remitterName = access.user.name?.trim() ?? "";
    const remitterEmail = access.user.email?.trim() ?? "";
    if (!remitterName || !remitterEmail) return noStoreJson({ error: "missing_remitter" }, 400);
    const model = buildRemittanceModel({
      contractorId: data.contractor.id,
      contractorName: data.contractor.name,
      weekStart: data.weekStart,
      weekEnd: data.weekEnd,
      remitterName,
      remitterEmail,
      entries: data.entries,
    });
    const pdf = await renderRemittancePdf(model);
    return new Response(pdf as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${model.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "business_required") return noStoreJson({ error: "not_found" }, 404);
    if (error instanceof Error && error.message === "no_entries") return noStoreJson({ error: "no_entries" }, 400);
    if (error instanceof Error && error.message === "missing_remitter") return noStoreJson({ error: "missing_remitter" }, 400);
    return await apiError(error, request);
  }
}
