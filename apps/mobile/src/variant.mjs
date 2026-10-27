export const APP_ID = "nz.co.jnok.cleantrack";

const VARIANTS = {
  development: { name: "CleanTrack (Dev)", suffix: ".dev" },
  preview: { name: "CleanTrack (Preview)", suffix: ".preview" },
  production: { name: "CleanTrack", suffix: "" },
};

export function appVariant(value) {
  if (value === "preview" || value === "production") return value;
  return "development";
}

export function applicationId(variant) {
  return `${APP_ID}${VARIANTS[variant].suffix}`;
}

export function applicationName(variant) {
  return VARIANTS[variant].name;
}
