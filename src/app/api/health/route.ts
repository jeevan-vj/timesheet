import { env } from "cloudflare:workers";

const responseHeaders = {
  "Cache-Control": "no-store",
};

export async function GET() {
  try {
    const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();

    if (result?.ok !== 1) {
      throw new Error("database_health_check_failed");
    }

    return Response.json(
      { status: "ok", database: "ok", release: env.RELEASE_SHA },
      { headers: responseHeaders },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: responseHeaders },
    );
  }
}
