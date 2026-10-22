import { z } from "zod";
import { db } from "@/db/client";
import { auth } from "@/lib/auth";
import { noStoreJson } from "@/lib/accounts-config";
import { apiError, readJson } from "@/lib/api";
import { inspectInvite } from "@/services/invites";

const signupInput = z.object({
  name: z.string().trim().min(1).max(100),
  password: z.string().min(12).max(128),
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let invitation: Awaited<ReturnType<typeof inspectInvite>>;
  try {
    invitation = await inspectInvite(db, token);
  } catch (error) {
    return apiError(error, request);
  }

  try {
    const input = signupInput.parse(await readJson(request));
    const result = await auth.api.signUpEmail({
      body: { name: input.name, email: invitation.invitedEmail, password: input.password },
      headers: request.headers,
      returnHeaders: true,
    });
    const headers = new Headers(result.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify({ created: true }), { status: 200, headers });
  } catch {
    return noStoreJson({ error: "signup_unavailable" }, 400);
  }
}
