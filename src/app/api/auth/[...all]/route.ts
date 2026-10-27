import { auth } from "@/lib/auth";
import { noStoreJson } from "@/lib/accounts-config";
import { toNextJsHandler } from "better-auth/next-js";

const handlers = toNextJsHandler(auth);
// Database failures can contain bound credentials or account details. Never
// allow those exceptions to reach the framework's request error logger.
export async function GET(request: Request) {
  try { return await handlers.GET(request); }
  catch { return noStoreJson({ error: "service_unavailable" }, 503); }
}
export async function POST(request: Request) {
  try { return await handlers.POST(request); }
  catch { return noStoreJson({ error: "service_unavailable" }, 503); }
}
