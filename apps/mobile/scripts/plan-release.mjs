import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Choose an OTA or a new iOS store build from the production fingerprint.

export const RELEASE_MODES = ["auto", "force-build", "force-update"];
const REUSABLE_STATUSES = ["FINISHED", "IN_PROGRESS", "IN_QUEUE", "NEW"];
const FINGERPRINT_HASH = /^[a-f0-9]{7,128}$/i;
const GIT_SHA = /^[a-f0-9]{40}$/i;

export function normalizeStatus(status) {
  return String(status ?? "")
    .trim()
    .toUpperCase()
    .replaceAll("-", "_");
}

export function requireFingerprintHash(value) {
  const hash = String(value ?? "").trim();
  if (!FINGERPRINT_HASH.test(hash)) throw new Error("fingerprint hash is missing or not hex");
  return hash.toLowerCase();
}

function requireSha(value) {
  const sha = String(value ?? "").trim().toLowerCase();
  if (!GIT_SHA.test(sha)) throw new Error("git sha is missing or not hex");
  return sha;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function readFingerprintDocument(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("fingerprint JSON could not be parsed");
  }
  const hash = parsed && typeof parsed === "object" ? parsed.hash : "";
  return requireFingerprintHash(hash);
}

export function readBuildsDocument(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("EAS build list could not be parsed");
  }
  if (!Array.isArray(parsed)) throw new Error("EAS build list must be a JSON array");
  return parsed;
}

export function artifactExpired(build, now) {
  if (build?.isExpired === true) return true;
  const raw = text(build?.expirationDate);
  if (!raw) return false;
  const time = Date.parse(raw);
  return !Number.isNaN(time) && time <= now.getTime();
}

function sameText(value, expected) {
  return text(value).toLowerCase() === expected;
}

function storeDistribution(build) {
  if (build.simulator === true) return false;
  return text(build.distribution).toUpperCase() === "STORE";
}

function hashMatches(build, hash) {
  const fromFingerprint = [text(build.fingerprintHash), text(build.fingerprint?.hash)].filter(Boolean);
  if (fromFingerprint.length > 0) return fromFingerprint.some((candidate) => candidate.toLowerCase() === hash);
  const runtime = text(build.runtimeVersion);
  if (!runtime) return false;
  return runtime.toLowerCase() === hash;
}

export function environmentReviewerCount(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("environment document is missing protection rules");
  }
  const rules = payload.protection_rules;
  if (!Array.isArray(rules)) throw new Error("environment document is missing protection rules");
  let count = 0;
  for (const rule of rules) {
    if (!rule || rule.type !== "required_reviewers" || !Array.isArray(rule.reviewers)) continue;
    count += rule.reviewers.filter((entry) => entry && typeof entry === "object").length;
  }
  if (count === 0) throw new Error("mobile-production has no required reviewer");
  return count;
}

function publicBuild(build, now) {
  return {
    id: text(build.id),
    status: normalizeStatus(build.status),
    appVersion: text(build.appVersion),
    appBuildVersion: text(build.appBuildVersion),
    channel: text(build.channel),
    artifactExpired: artifactExpired(build, now),
  };
}

export function matchingProductionBuilds(builds, { fingerprintHash, now = new Date() }) {
  const hash = requireFingerprintHash(fingerprintHash);
  const matches = [];
  for (const build of builds) {
    if (!build || typeof build !== "object") continue;
    const id = text(build.id);
    const status = normalizeStatus(build.status);
    if (!id || !REUSABLE_STATUSES.includes(status)) continue;
    if (!sameText(build.platform, "ios")) continue;
    if (!sameText(build.buildProfile, "production")) continue;
    if (!sameText(build.channel, "production")) continue;
    if (!storeDistribution(build)) continue;
    if (!hashMatches(build, hash)) continue;
    matches.push(publicBuild(build, now));
  }
  matches.sort((left, right) => REUSABLE_STATUSES.indexOf(left.status) - REUSABLE_STATUSES.indexOf(right.status));
  return matches;
}

function decisionBase(fields) {
  return {
    mode: fields.mode,
    fingerprintHash: fields.fingerprintHash,
    updateFingerprintHash: fields.updateFingerprintHash,
    reason: fields.reason,
    warning: fields.warning,
    matchingBuild: fields.matchingBuild,
  };
}

export function planMobileRelease({ mode = "auto", fingerprintHash, updateFingerprintHash, builds, now = new Date() }) {
  if (!RELEASE_MODES.includes(mode)) throw new Error(`unknown mobile release mode: ${mode}`);
  if (!Array.isArray(builds)) throw new Error("EAS build list must be a JSON array");
  const hash = requireFingerprintHash(fingerprintHash);
  const updateHash =
    updateFingerprintHash == null || updateFingerprintHash === "" ? hash : requireFingerprintHash(updateFingerprintHash);
  const matchingBuild = matchingProductionBuilds(builds, { fingerprintHash: hash, now })[0] ?? null;
  const shared = { mode, fingerprintHash: hash, updateFingerprintHash: updateHash, matchingBuild };

  if (updateHash !== hash) {
    return {
      path: "blocked",
      ...decisionBase({
        ...shared,
        reason: "The production build profile fingerprint does not match the fingerprint computed with the production EAS environment.",
        warning:
          "No OTA was published and no build was started. extra.apiUrl is part of the fingerprint, so an EXPO_PUBLIC_API_URL that differs from the build profile would publish an update the binary cannot receive.",
      }),
    };
  }

  if (mode === "force-build") {
    return {
      path: "build",
      ...decisionBase({
        ...shared,
        reason: "workflow_dispatch selected force-build.",
        warning: matchingBuild
          ? "A production iOS build with this fingerprint already exists. force-build still starts another store build. The remote build number increments once."
          : "",
      }),
    };
  }

  if (mode === "force-update") {
    return {
      path: "update",
      ...decisionBase({
        ...shared,
        reason: "workflow_dispatch selected force-update.",
        warning: matchingBuild
          ? ""
          : "No production iOS build has this fingerprint. The update will not reach installed binaries until one exists.",
      }),
    };
  }

  if (matchingBuild) {
    let warning = "";
    if (matchingBuild.status !== "FINISHED") {
      warning =
        "No finished production binary has this fingerprint yet. The OTA targets the in-progress build's runtime and reaches devices after that binary is installed.";
    } else if (matchingBuild.artifactExpired) {
      warning =
        "The matching build artifact on EAS has expired. Installed TestFlight binaries with this fingerprint can still receive the OTA.";
    }
    return {
      path: "update",
      ...decisionBase({
        ...shared,
        reason: "A production iOS build with this fingerprint already exists.",
        warning,
      }),
    };
  }

  return {
    path: "build",
    ...decisionBase({
      ...shared,
      reason: "No production iOS build with this fingerprint exists.",
      warning: "",
    }),
  };
}

export function formatDecisionSummary(decision, { sha }) {
  const labels = {
    update: "Publish an OTA to the production channel",
    build: "EAS iOS production build and TestFlight submit",
    blocked: "Stop. The build-profile fingerprint and the update-environment fingerprint disagree",
  };
  const lines = [
    "### Mobile production release",
    "",
    `- Commit: \`${sha}\``,
    `- Mode: \`${decision.mode}\``,
    "- Platform: iOS",
    `- Build fingerprint: \`${decision.fingerprintHash}\``,
  ];
  if (decision.updateFingerprintHash !== decision.fingerprintHash) {
    lines.push(`- Update fingerprint: \`${decision.updateFingerprintHash}\``);
  }
  lines.push(`- Decision: ${labels[decision.path]}`);
  lines.push(`- Reason: ${decision.reason}`);
  if (decision.matchingBuild) {
    const build = decision.matchingBuild;
    const version = [build.appVersion, build.appBuildVersion].filter(Boolean).join(" / ");
    const channel = build.channel ? `, channel ${build.channel}` : "";
    const expired = build.artifactExpired ? ", EAS artifact expired" : "";
    lines.push(`- Matching build: \`${build.id}\` (${build.status}${version ? `, ${version}` : ""}${channel}${expired})`);
  } else {
    lines.push("- Matching build: none");
  }
  if (decision.warning) {
    lines.push("", decision.warning);
  }
  lines.push("");
  if (decision.path === "blocked") {
    lines.push("The mobile-production environment was not asked to approve a publish or a build.");
  } else {
    lines.push("The next job waits for approval in the GitHub environment `mobile-production`.");
  }
  lines.push(
    "",
    "Build numbers come from the EAS remote counter (`appVersionSource: remote`, `build.production.autoIncrement: true`). This workflow does not set a build number.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function collectOptions(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === `--${name}`) {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`missing value for --${name}`);
      values.push(next);
      index += 1;
    } else if (arg.startsWith(`--${name}=`)) {
      values.push(arg.slice(name.length + 3));
    }
  }
  return values;
}

function singleOption(argv, name) {
  const values = collectOptions(argv, name);
  if (values.length > 1) throw new Error(`--${name} was provided more than once`);
  return values[0] ?? "";
}

function githubOutput(fields) {
  return Object.entries(fields)
    .map(([key, value]) => {
      const line = String(value ?? "");
      if (/[\r\n]/.test(line)) throw new Error(`output ${key} must be one line`);
      return `${key}=${line}\n`;
    })
    .join("");
}

export function runPlanCli(argv, io = {}) {
  const writeOut = io.stdout ?? ((chunk) => process.stdout.write(chunk));
  const writeErr = io.stderr ?? ((chunk) => process.stderr.write(chunk));
  try {
    const printHash = singleOption(argv, "print-hash");
    if (printHash) {
      writeOut(`${readFingerprintDocument(readFileSync(printHash, "utf8"))}\n`);
      return { exitCode: 0 };
    }

    const reviewersFile = singleOption(argv, "require-reviewers");
    if (reviewersFile) {
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(reviewersFile, "utf8"));
      } catch {
        throw new Error("environment JSON could not be parsed");
      }
      writeOut(`reviewers=${environmentReviewerCount(parsed)}\n`);
      return { exitCode: 0 };
    }

    const mode = singleOption(argv, "mode") || "auto";
    const fingerprintFile = singleOption(argv, "fingerprint-file");
    const updateFile = singleOption(argv, "update-fingerprint-file");
    const buildFiles = collectOptions(argv, "builds");
    const summaryFile = singleOption(argv, "summary");
    const outputFile = singleOption(argv, "github-output");
    const sha = requireSha(singleOption(argv, "sha"));
    if (!fingerprintFile) throw new Error("missing value for --fingerprint-file");
    if (buildFiles.length === 0) throw new Error("missing value for --builds");

    const fingerprintHash = readFingerprintDocument(readFileSync(fingerprintFile, "utf8"));
    const updateFingerprintHash = updateFile ? readFingerprintDocument(readFileSync(updateFile, "utf8")) : fingerprintHash;
    const builds = buildFiles.flatMap((file) => readBuildsDocument(readFileSync(file, "utf8")));
    const decision = planMobileRelease({ mode, fingerprintHash, updateFingerprintHash, builds });
    const summary = formatDecisionSummary(decision, { sha });
    if (summaryFile) appendFileSync(summaryFile, summary);
    writeOut(`${JSON.stringify(decision)}\n`);
    if (decision.path === "blocked") return { exitCode: 1, decision, summary };
    if (outputFile) {
      appendFileSync(
        outputFile,
        githubOutput({
          path: decision.path,
          fingerprint: decision.fingerprintHash,
          matching_build_id: decision.matchingBuild?.id ?? "",
          sha,
        }),
      );
    }
    return { exitCode: 0, decision, summary };
  } catch (error) {
    writeErr(`${error instanceof Error ? error.message : "mobile release plan failed"}\n`);
    return { exitCode: 1 };
  }
}

function main() {
  const result = runPlanCli(process.argv.slice(2));
  process.exitCode = result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
