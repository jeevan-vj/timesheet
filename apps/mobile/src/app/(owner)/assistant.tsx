import { OwnerAssistantChat } from "@/components/owner-assistant-chat";
import { Screen } from "@/ui";

export { ErrorBoundary } from "@/components/route-error-boundary";

export default function OwnerAssistantScreen() {
  return <Screen testID="owner-assistant" title="Ask CleanTrack"><OwnerAssistantChat /></Screen>;
}
