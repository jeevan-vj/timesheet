import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const mobilePackage = (relativePath: string) =>
  realpathSync(fileURLToPath(new URL(relativePath, import.meta.url)));

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Not installed at the repo root. The mobile online test and apps/mobile share this build.
      "@tanstack/react-query": mobilePackage(
        "./apps/mobile/node_modules/@tanstack/react-query/build/modern/index.js",
      ),
      "expo-network": mobilePackage("./apps/mobile/node_modules/expo-network/build/Network.js"),
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.{ts,mjs}"] },
});
