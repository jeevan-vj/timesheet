import { securityHeaders } from "./src/lib/security-headers";

export default {
  async headers() {
    return [
      { source: "/invite/:token*", headers: [{ key: "Cache-Control", value: "no-store" }] },
      { source: "/:path*", headers: securityHeaders },
    ];
  },
};
