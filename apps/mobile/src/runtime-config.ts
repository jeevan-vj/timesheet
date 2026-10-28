import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { resolveApiBaseUrl } from "@/api-config";

export function appVersion(): string {
  const version = Constants.expoConfig?.version;
  return typeof version === "string" && version.trim() ? version.trim() : "0.1.0";
}

export function updateChannel(): string | null {
  try {
    const channel = Updates.channel;
    if (typeof channel !== "string") return null;
    const trimmed = channel.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function apiBaseUrl(): string {
  const extra = Constants.expoConfig?.extra;
  const extraUrl = extra && typeof extra.apiUrl === "string" ? extra.apiUrl : null;
  const publicUrl = process.env.EXPO_PUBLIC_API_URL;
  return resolveApiBaseUrl({
    publicUrl: typeof publicUrl === "string" ? publicUrl : null,
    extraUrl,
  });
}
