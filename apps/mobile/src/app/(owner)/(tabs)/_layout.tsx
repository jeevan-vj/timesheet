import OwnerTabs from "@/components/owner-tabs";
import { ErrorBoundary, ScreenErrorBoundary } from "@/components/route-error-boundary";

export { ErrorBoundary };

export const unstable_settings = {
  screenErrorBoundary: ErrorBoundary,
};

export default function OwnerTabLayout() {
  return (
    <ScreenErrorBoundary>
      <OwnerTabs />
    </ScreenErrorBoundary>
  );
}
