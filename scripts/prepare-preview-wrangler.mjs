import fs from "node:fs";

const configPath = process.argv[2] ?? "dist/server/wrangler.json";
const databaseId = process.env.PREVIEW_D1_DATABASE_ID ?? "";
const previewUrl = process.env.PREVIEW_URL ?? "";
const releaseSha = process.env.GITHUB_SHA ?? "preview";

if (!databaseId || !previewUrl) {
  process.stderr.write("PREVIEW_D1_DATABASE_ID and PREVIEW_URL are required.\n");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
config.name = "cleantrack-timesheet-preview";
config.workers_dev = true;
config.vars = {
  ...(config.vars ?? {}),
  BETTER_AUTH_URL: previewUrl,
  AUTH_TRUSTED_ORIGINS: "",
  RELEASE_SHA: releaseSha,
};
for (const database of config.d1_databases ?? []) {
  database.database_name = "cleantrack-timesheet-preview";
  database.database_id = databaseId;
}

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
process.stdout.write("Prepared preview worker config for cleantrack-timesheet-preview.\n");
