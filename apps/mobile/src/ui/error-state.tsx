import { EmptyState } from "@/ui/empty-state";
import { PrimaryButton } from "@/ui/buttons";

export function ErrorState({ message = "We couldn't load this screen.", onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <EmptyState
      action={<PrimaryButton accessibilityLabel="Try again" onPress={onRetry}>Try again</PrimaryButton>}
      detail={`${message} Check your connection and try again.`}
      icon={{ ios: "arrow.clockwise", android: "refresh", web: "refresh" }}
      title="Couldn't load CleanTrack"
    />
  );
}
