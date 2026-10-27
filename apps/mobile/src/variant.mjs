export const APP_ID = "nz.co.jnok.cleantrack";

const VARIANTS = {
  development: { name: "CleanTrack (Dev)", suffix: ".dev" },
  preview: { name: "CleanTrack (Preview)", suffix: ".preview" },
  production: { name: "CleanTrack", suffix: "" },
};

export function appVariant(value) {
  if (value === "development" || value === "preview") return value;
  if (value === "production" || value == null || value === "") return "production";
  return "development";
}

export function applicationId(variant) {
  return `${APP_ID}${VARIANTS[variant].suffix}`;
}

export function applicationName(variant) {
  return VARIANTS[variant].name;
}
