import { db } from "@/db/client";
import { apiError, authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { buildRemittanceModel, renderRemittancePdf } from "@/lib/remittance";
import { weekStartInput } from "@/lib/validation";
import { getPortalWeekRemittance } from "@/services/portal";

const RESOURCE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export async function GET(
  request: Request,
  context: { params: Promise<{ week: string; business: string }> },
) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  const { week, business } = await context.params;
  const parsed = weekStartInput.safeParse(week);
  if (!parsed.success) return noStoreJson({ error: "invalid_week" }, 400);
  if (!RESOURCE_ID.test(business)) return noStoreJson({ error: "not_found" }, 404);
  try {
    const model = buildRemittanceModel(await getPortalWeekRemittance(db, access.user.id, business, parsed.data));
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
    if (error instanceof Error && error.message === "not_found") return noStoreJson({ error: "not_found" }, 404);
    if (error instanceof Error && error.message === "no_entries") return noStoreJson({ error: "no_entries" }, 400);
    return await apiError(error, request);
  }
}
