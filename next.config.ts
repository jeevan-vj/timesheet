import { securityHeaders } from "./src/lib/security-headers";

export default {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
