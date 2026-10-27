import { env } from "cloudflare:workers";
import { db } from "@/db/client";
import { noStoreJson } from "@/lib/accounts-config";
import { apiError, readJson } from "@/lib/api";
import { parseAcceptBody } from "@/lib/invite-public";
import { beginInvitePost, clientUserAgent } from "@/lib/invitation-rate-limit";
import { getBetterAuthUrl, getSecureCookies } from "@/lib/runtime-env";
import { requireSessionUser } from "@/lib/request-session";
import { acceptInvitation } from "@/services/invitation-accept";

const STATUS: Record<string, number> = {
  unknown: 400,
  expired: 400,
  revoked: 400,
  used: 400,
  email_mismatch: 400,
  password_mismatch: 400,
  weak_password: 400,
  account_mismatch: 403,
  sign_in_required: 409,
};

export async function POST(request: Request): Promise<Response> {
  const gate = await beginInvitePost(request, db, "accept");
  if (gate instanceof Response) return gate;
  try {
    const parsed = parseAcceptBody(await readJson(request));
    if (!parsed) return noStoreJson({ error: "invalid_request" }, 400);
    const result = await acceptInvitation(db, {
      ...parsed,
      session: await requireSessionUser(request),
      secret: env.BETTER_AUTH_SECRET,
      baseURL: getBetterAuthUrl(),
      secureCookies: getSecureCookies(),
      ipAddress: gate.address,
      userAgent: clientUserAgent(request),
    });
    if (!result.ok) return noStoreJson({ error: result.error }, STATUS[result.error] ?? 400);
    const response = noStoreJson({ ok: true });
    if (result.setCookie) response.headers.append("Set-Cookie", result.setCookie);
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "auth_unavailable") return noStoreJson({ error: "service_unavailable" }, 503);
    return apiError(error, request);
  }
}
