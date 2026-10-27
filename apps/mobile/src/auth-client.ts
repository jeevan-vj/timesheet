import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { MOBILE_CLIENT_HEADER, mobileClientValue } from "@/api-config";
import { apiBaseUrl, appVersion } from "@/runtime-config";

export const authClient = createAuthClient({
  baseURL: apiBaseUrl(),
  fetchOptions: {
    headers: {
      [MOBILE_CLIENT_HEADER]: mobileClientValue(appVersion()),
    },
  },
  plugins: [
    expoClient({
      scheme: "cleantrack",
      storagePrefix: "cleantrack",
      storage: SecureStore,
    }),
  ],
});
