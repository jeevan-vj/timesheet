import type { ConfigContext, ExpoConfig } from "expo/config";
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
    ios: {
      ...config.ios,
      bundleIdentifier: id,
      supportsTablet: true,
    },
    android: {
      ...config.android,
      package: id,
      predictiveBackGestureEnabled: true,
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
    experiments: {
      typedRoutes: true,
    },
    extra: {
      eas: {
        projectId: "2ac1a147-bf37-4ee6-9274-d896f7bd87a9",
      },
    },
  };
};
