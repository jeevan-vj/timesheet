export const APP_ID: "nz.co.jnok.cleantrack";
export type AppVariant = "development" | "preview" | "production";
export function appVariant(value: string | undefined): AppVariant;
export function applicationId(variant: AppVariant): string;
export function applicationName(variant: AppVariant): string;
