import { auth } from "@/lib/auth";

export type SessionUser = { id: string; email: string; name: string };

export async function requireSessionUser(request: Request): Promise<SessionUser | null> {
  if (!request.headers.get("cookie")) return null;
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) return null;
    return { id: session.user.id, email: session.user.email, name: session.user.name };
  } catch {
    return null;
  }
}
