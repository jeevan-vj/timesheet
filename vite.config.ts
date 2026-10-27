import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import vinext from "vinext";

export default defineConfig(({ mode }) => ({
  ssr: { noExternal: ["@cleantrack/core"] },
  optimizeDeps: { exclude: ["@cleantrack/core"] },
  plugins: [
    vinext(),
    mode !== "test"
      ? cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] } })
      : null,
  ],
}));
