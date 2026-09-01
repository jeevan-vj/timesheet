import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { siteInput } from "@/lib/validation";
import { archiveSite, getSite, updateSite } from "@/services/sites";

function invalidId(id: string) {
  return !id || id.length > 64;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (invalidId(id)) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    return noStoreJson(await getSite(db, access.user.id, id));
  } catch (error) {
    if (error instanceof Error && error.message === "not_found") return noStoreJson({ error: "not_found" }, 404);
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (invalidId(id)) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    const input = siteInput.parse(await readJson(request));
    return noStoreJson(await updateSite(db, access.user.id, id, input));
  } catch (error) {
    if (error instanceof Error && error.message === "not_found") return noStoreJson({ error: "not_found" }, 404);
    if (error instanceof Error && error.message === "duplicate_site") return noStoreJson({ error: "duplicate_site" }, 409);
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (invalidId(id)) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    return noStoreJson(await archiveSite(db, access.user.id, id));
  } catch (error) {
    if (error instanceof Error && error.message === "not_found") return noStoreJson({ error: "not_found" }, 404);
    return apiError(error);
  }
}
