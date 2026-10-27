import AppTabs from "@/components/app-tabs";
import { ErrorBoundary } from "@/components/route-error-boundary";

export { ErrorBoundary };

export const unstable_settings = {
  screenErrorBoundary: ErrorBoundary,
};

export default function ContractorTabs() {
  return <AppTabs />;
}
