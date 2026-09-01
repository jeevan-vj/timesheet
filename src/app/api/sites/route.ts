import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { parseIncludeArchived, siteInput } from "@/lib/validation";
import { createSite, listSites } from "@/services/sites";

export async function GET(request: Request) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  try {
    const includeArchived = parseIncludeArchived(new URL(request.url).searchParams.get("includeArchived"));
    return noStoreJson(await listSites(db, access.user.id, includeArchived));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  try {
    const input = siteInput.parse(await readJson(request));
    return noStoreJson(await createSite(db, access.user.id, input), 201);
  } catch (error) {
    if (error instanceof Error && error.message === "duplicate_site") return noStoreJson({ error: "duplicate_site" }, 409);
    return apiError(error);
  }
}
