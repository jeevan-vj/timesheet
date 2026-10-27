import type { ConfigContext, ExpoConfig } from "expo/config";
import { PRODUCTION_API_URL } from "./src/api-config.mjs";
import { theme } from "./src/theme-tokens.mjs";
import { applicationId, applicationName, appVariant } from "./src/variant.mjs";

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = appVariant(process.env.APP_VARIANT);
  const id = applicationId(variant);
  return {
    ...config,
    name: applicationName(variant),
    slug: "cleantrack",
    owner: "jnok",
    version: "0.1.0",
    orientation: "default",
    scheme: "cleantrack",
    userInterfaceStyle: "dark",
    icon: "./assets/images/icon.png",
    backgroundColor: theme.background,
    runtimeVersion: { policy: "fingerprint" },
    updates: {
      url: "https://u.expo.dev/2ac1a147-bf37-4ee6-9274-d896f7bd87a9",
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
    },
    ios: {
      ...config.ios,
      bundleIdentifier: id,
      supportsTablet: true,
      infoPlist: {
        ...config.ios?.infoPlist,
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      ...config.android,
      package: id,
      predictiveBackGestureEnabled: true,
      softwareKeyboardLayoutMode: "resize",
      adaptiveIcon: {
        backgroundColor: theme.background,
        foregroundImage: "./assets/images/android-icon-foreground.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
    },
    web: {
      output: "single",
      favicon: "./assets/images/favicon.png",
      backgroundColor: theme.background,
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "expo-dev-client",
      [
        "expo-splash-screen",
        {
          backgroundColor: theme.background,
          image: "./assets/images/splash-icon.png",
          imageWidth: 76,
        },
      ],
    ],
    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL?.trim() || PRODUCTION_API_URL,
      eas: {
        projectId: "2ac1a147-bf37-4ee6-9274-d896f7bd87a9",
      },
    },
    experiments: {
      typedRoutes: true,
    },
  };
};
