import fs from "node:fs";
import path from "node:path";

const rules = [
  {
    re: /\bconsole\.(log|info|debug|warn|error)\s*\(/,
    message: "console output is banned in src; it can leak contractor, rate, note, or request data",
  },
  {
    re: /\b(TODO|FIXME|HACK|XXX)\b/,
    message: "leave no TODO/FIXME/HACK markers; encode the constraint in code or a test",
  },
  {
    re: /\bworkaround\b/i,
    message: "workaround comments spread; fix the cause or make the bad pattern impossible",
  },
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const files = walk("src");
const failures = [];
for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    for (const rule of rules) {
      if (rule.re.test(line)) failures.push(`${file}:${index + 1}: ${rule.message}`);
    }
  });
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`paved-path lint ok (${files.length} files)\n`);
