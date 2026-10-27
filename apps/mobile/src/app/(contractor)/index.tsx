import { HealthBanner } from "@/components/health-banner";
import { PlaceholderScreen } from "@/components/placeholder-screen";
import { SignedInIdentity } from "@/components/signed-in-identity";

export default function HomeScreen() {
  return (
    <PlaceholderScreen title="Home" detail="Your next job will show here.">
      <SignedInIdentity />
      <HealthBanner />
    </PlaceholderScreen>
  );
}
