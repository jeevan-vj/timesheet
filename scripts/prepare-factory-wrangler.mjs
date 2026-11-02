import fs from "node:fs";
import path from "node:path";

if (process.env.FACTORY_E2E_BASE_URL) {
  const configPath = path.resolve("dist/server/wrangler.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  delete config.ai;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  process.stdout.write("Prepared generated Wrangler config for credential-free Factory E2E.\n");
}
