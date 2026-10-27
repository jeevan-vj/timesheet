import { HealthBanner } from "@/components/health-banner";
import { PlaceholderScreen } from "@/components/placeholder-screen";

export default function HomeScreen() {
  return (
    <PlaceholderScreen title="Home" detail="Your next job will show here.">
      <HealthBanner />
    </PlaceholderScreen>
  );
}
