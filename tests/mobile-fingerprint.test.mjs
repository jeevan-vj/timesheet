import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mobile = join(root, "apps", "mobile");
const variantPath = join(mobile, "src", "variant.mjs");
const configPath = join(mobile, "app.config.ts");
const fingerprintConfigPath = join(mobile, "fingerprint.config.js");
const originalVariant = readFileSync(variantPath, "utf8");
const originalConfig = readFileSync(configPath, "utf8");

const CONFIG_IMPORTS = ["src/api-config.mjs", "src/theme-tokens.mjs", "src/variant.mjs"];

function generate(extraEnv = {}) {
  const env = { ...process.env, APP_VARIANT: "production" };
  delete env.EAS_BUILD;
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value == null) delete env[key];
    else env[key] = value;
  }
  const result = spawnSync(
    join(mobile, "node_modules", ".bin", "expo-updates"),
    ["fingerprint:generate", "--platform", "ios"],
    {
      cwd: mobile,
      env,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `fingerprint exited ${result.status}`);
  }
  return JSON.parse(result.stdout);
}

function writeNativeTree() {
  mkdirSync(join(mobile, "ios", "CleanTrack.xcodeproj"), { recursive: true });
  writeFileSync(join(mobile, "ios", "CleanTrack.xcodeproj", "project.pbxproj"), "native-marker\n");
  mkdirSync(join(mobile, "android", "app", "src", "main"), { recursive: true });
  writeFileSync(join(mobile, "android", "app", "build.gradle"), "apply plugin: 'com.android.application'\n");
  writeFileSync(
    join(mobile, "android", "app", "src", "main", "AndroidManifest.xml"),
    "<manifest package=\"nz.co.jnok.cleantrack\" />\n",
  );
}

function removeNativeTrees() {
  rmSync(join(mobile, "ios"), { recursive: true, force: true });
  rmSync(join(mobile, "android"), { recursive: true, force: true });
}

function gitThatMissesIgnores() {
  const dir = join(tmpdir(), "cleantrack-fingerprint-git");
  mkdirSync(dir, { recursive: true });
  const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  const script = join(dir, "git");
  writeFileSync(
    script,
    `#!/bin/sh
if [ "$1" = "check-ignore" ]; then
  exit 1
fi
exec ${JSON.stringify(realGit)} "$@"
`,
  );
  spawnSync("chmod", ["755", script]);
  return dir;
}

function preloadThatSkipsConfigModules() {
  const file = join(tmpdir(), "cleantrack-fingerprint-untrace.cjs");
  writeFileSync(
    file,
    `const Module = require("module");
const proto = Module.prototype;
let impl = proto._compile;
const bare = impl;
Object.defineProperty(proto, "_compile", {
  configurable: true,
  enumerable: false,
  get() {
    return impl;
  },
  set(next) {
    impl = function (content, filename, ...rest) {
      if (typeof filename === "string" && /[/\\\\]src[/\\\\](?:api-config|theme-tokens|variant)\\.mjs$/.test(filename)) {
        return bare.call(this, content, filename, ...rest);
      }
      return next.call(this, content, filename, ...rest);
    };
  },
});
Object.defineProperty(Module, "registerHooks", {
  configurable: true,
  writable: true,
  value() {
    return { deregister() {} };
  },
});
`,
  );
  return file;
}

describe("mobile runtime fingerprint", () => {
  afterEach(() => {
    writeFileSync(variantPath, originalVariant);
    writeFileSync(configPath, originalConfig);
    removeNativeTrees();
  });

  it("lists every local app.config.ts import and ignores generated native directories", () => {
    const config = readFileSync(configPath, "utf8");
    const fingerprintConfig = readFileSync(fingerprintConfigPath, "utf8");
    const imports = [...config.matchAll(/from "\.\/(src\/[^"]+)"/g)].map((match) => match[1]);
    expect(imports).toEqual(CONFIG_IMPORTS);
    for (const file of imports) {
      expect(fingerprintConfig).toContain(`filePath: "${file}"`);
    }
    expect(fingerprintConfig).toContain('"ios/**/*"');
    expect(fingerprintConfig).toContain('"android/**/*"');
  });

  it(
    "matches with EAS_BUILD set, a generated native tree, and config modules the loader did not trace",
    () => {
      const baseline = generate();
      expect(baseline.hash).toMatch(/^[0-9a-f]{40}$/);
      for (const file of CONFIG_IMPORTS) {
        expect(baseline.sources.some((source) => source.filePath === file && source.hash)).toBe(true);
      }

      expect(generate({ EAS_BUILD: "true" }).hash).toBe(baseline.hash);
      expect(generate({ EAS_BUILD: undefined }).hash).toBe(baseline.hash);

      mkdirSync(join(mobile, "ios"));
      mkdirSync(join(mobile, "android"));
      expect(generate().hash).toBe(baseline.hash);

      writeNativeTree();
      expect(generate().hash).toBe(baseline.hash);
      expect(generate({ PATH: `${gitThatMissesIgnores()}:${process.env.PATH}` }).hash).toBe(baseline.hash);

      const preload = preloadThatSkipsConfigModules();
      const untraced = generate({ NODE_OPTIONS: `--require ${preload}` });
      expect(untraced.hash).toBe(baseline.hash);
      for (const file of CONFIG_IMPORTS) {
        expect(untraced.sources.some((source) => source.filePath === file && source.hash)).toBe(true);
      }
    },
    60_000,
  );

  it(
    "changes when a config module or native app config changes",
    () => {
      const baseline = generate().hash;
      writeFileSync(variantPath, `${originalVariant}\n`);
      expect(generate().hash).not.toBe(baseline);
      writeFileSync(variantPath, originalVariant);

      const edited = originalConfig.replace("supportsTablet: true", "supportsTablet: false");
      expect(edited).not.toBe(originalConfig);
      writeFileSync(configPath, edited);
      expect(generate().hash).not.toBe(baseline);
    },
    60_000,
  );
});
