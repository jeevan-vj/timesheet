import { Platform } from "react-native";
import { buildApiRequest, sessionEndsOnStatus } from "@/api-config";
import { authClient } from "@/auth-client";
import { apiBaseUrl, appVersion } from "@/runtime-config";

let endingSession = false;

export async function endSession(): Promise<void> {
  if (endingSession) return;
  endingSession = true;
  try {
    await authClient.signOut();
  } catch {
    // The Expo plugin clears secure storage before the sign-out request returns.
  } finally {
    endingSession = false;
  }
}

export async function mobileFetch(path: string, init?: RequestInit): Promise<Response> {
  const web = Platform.OS === "web";
  const cookie = web ? "" : await authClient.getCookie();
  const request = buildApiRequest({
    baseUrl: apiBaseUrl(),
    path,
    version: appVersion(),
    cookie,
    headers: init?.headers,
    transport: web ? "web" : "native",
  });
  const response = await fetch(request.url, {
    ...init,
    headers: request.headers,
    credentials: request.credentials,
  });
  if (sessionEndsOnStatus(response.status)) await endSession();
  return response;
}
