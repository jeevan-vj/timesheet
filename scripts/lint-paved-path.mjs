import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(repoRoot);

const consoleRule = {
  re: /\bconsole\.(log|info|debug|warn|error)\s*\(/,
  message: "console output is banned; it can leak contractor, rate, note, or request data",
};

const markerRule = {
  re: /\b(TODO|FIXME|HACK|XXX)\b/,
  message: "leave no TODO/FIXME/HACK markers; encode the constraint in code or a test",
};

const workaroundRule = {
  re: /\bworkaround\b/i,
  message: "workaround comments spread; fix the cause or make the bad pattern impossible",
};

const coreImportRule = {
  re: /(?:from\s+|import\s*\(\s*|import\s+)["'](?:react(?:-dom|-native(?:-web)?)?(?:\/[^"']*)?|cloudflare:[^"']*)["']/,
  message: "packages/core cannot import React, React Native, or cloudflare:*",
};

const colorRule = {
  re: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b|\brgba?\(|\bhsla?\(/,
  message: "hard-coded colours belong in apps/mobile/src/theme.ts",
};

const skipDirs = new Set(["node_modules", ".expo", "dist", "web-build", "ios", "android"]);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function normalized(file) {
  return file.split(path.sep).join("/");
}

function allowsConsole(file) {
  const name = normalized(file);
  return name.endsWith("src/lib/report-server-error.ts") || name.endsWith("apps/mobile/src/report-screen-error.ts");
}

function allowsColor(file) {
  const name = normalized(file);
  return name.endsWith("apps/mobile/src/theme.ts") || name.endsWith("apps/mobile/src/theme-tokens.mjs");
}

function rulesFor(file) {
  const rules = [];
  if (!allowsConsole(file)) rules.push(consoleRule);
  rules.push(markerRule, workaroundRule);
  const name = normalized(file);
  if (name.includes("packages/core/")) rules.push(coreImportRule);
  if (name.includes("apps/mobile/") && !allowsColor(file)) rules.push(colorRule);
  return rules;
}

function lintFile(file, failures) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const rules = rulesFor(file);
  lines.forEach((line, index) => {
    for (const rule of rules) {
      if (rule.re.test(line)) failures.push(`${file}:${index + 1}: ${rule.message}`);
    }
  });
}

function assertCoreLib(failures) {
  const config = JSON.parse(fs.readFileSync("packages/core/tsconfig.json", "utf8"));
  const libs = config.compilerOptions?.lib ?? [];
  const hasDom = libs.some((lib) => String(lib).toLowerCase().includes("dom"));
  if (hasDom) failures.push("packages/core/tsconfig.json: DOM lib is not allowed in @cleantrack/core");
}

const roots = process.argv.slice(2);
const targets = roots.length > 0 ? roots : ["src", "packages/core"];
const files = targets.flatMap((root) => walk(root));
const failures = [];
if (roots.length === 0) assertCoreLib(failures);
for (const file of files) lintFile(file, failures);

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`paved-path lint ok (${files.length} files)\n`);
