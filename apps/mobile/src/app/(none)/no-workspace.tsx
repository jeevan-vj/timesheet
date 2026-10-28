import * as Linking from "expo-linking";
import { endSession } from "@/api";
import { apiBaseUrl } from "@/runtime-config";
import { EmptyState, PrimaryButton, Screen, SecondaryButton } from "@/ui";

export default function NoWorkspaceScreen() {
  return (
    <Screen testID="no-workspace" title="CleanTrack">
      <EmptyState
        action={
          <>
            <PrimaryButton
              accessibilityLabel="Set up CleanTrack on web"
              onPress={() => void Linking.openURL(`${apiBaseUrl()}/dashboard`)}
            >
              Set up on web
            </PrimaryButton>
            <SecondaryButton accessibilityLabel="Sign out" onPress={() => void endSession()}>
              Sign out
            </SecondaryButton>
          </>
        }
        detail="Ask the business owner for an invitation, or finish setting up your business in the web dashboard."
        icon={{ ios: "person.crop.circle.badge.questionmark", android: "person_help", web: "person_help" }}
        title="No workspace yet"
      />
    </Screen>
  );
}
