import { db } from "@/db/client";
import { noStoreJson } from "@/lib/accounts-config";
import { apiError, readJson } from "@/lib/api";
import { parsePreviewBody } from "@/lib/invite-public";
import { beginInvitePost } from "@/lib/invitation-rate-limit";
import { requireSessionUser } from "@/lib/request-session";
import { previewInvitation } from "@/services/invitation-accept";

export async function POST(request: Request): Promise<Response> {
  const gate = await beginInvitePost(request, db, "preview");
  if (gate instanceof Response) return gate;
  try {
    const parsed = parsePreviewBody(await readJson(request));
    if (!parsed) return noStoreJson({ error: "invalid_request" }, 400);
    const session = await requireSessionUser(request);
    return noStoreJson(await previewInvitation(db, { token: parsed.token, session }));
  } catch (error) {
    return apiError(error, request);
  }
}
