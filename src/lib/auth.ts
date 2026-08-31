import { env } from "cloudflare:workers";
import { db } from "@/db/client";
import { createAuth } from "@/lib/auth-options";
import { getSecureCookies, getTrustedOrigins } from "@/lib/runtime-env";

export const auth = createAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  db,
  trustedOrigins: getTrustedOrigins(),
  secureCookies: getSecureCookies(),
});
