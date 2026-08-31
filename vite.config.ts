import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import vinext from "vinext";

export default defineConfig(({ mode }) => ({
  plugins: [
    vinext(),
    mode !== "test"
      ? cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] } })
      : null,
  ],
}));
