import * as Linking from "expo-linking";
import { endSession } from "@/api";
import { apiBaseUrl } from "@/runtime-config";
import { EmptyState, PrimaryButton, Screen, SecondaryButton } from "@/ui";

export default function OwnerHoldingScreen() {
  return (
    <Screen testID="owner-holding" title="CleanTrack">
      <EmptyState
        action={
          <>
            <PrimaryButton
              accessibilityLabel="Open owner dashboard on web"
              onPress={() => void Linking.openURL(`${apiBaseUrl()}/dashboard`)}
            >
              Open dashboard on web
            </PrimaryButton>
            <SecondaryButton accessibilityLabel="Sign out" onPress={() => void endSession()}>
              Sign out
            </SecondaryButton>
          </>
        }
        detail="Sites, shifts and payroll are still managed in the web dashboard. The owner mobile workspace is next."
        icon={{ ios: "building.2", android: "business", web: "business" }}
        title="Owner tools are coming to the app"
      />
    </Screen>
  );
}
