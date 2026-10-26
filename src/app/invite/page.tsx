import { AuthShell } from "@/components/auth-shell";

export default function InvitePage() {
  return <AuthShell>
    <p className="eyebrow">Invitation</p>
    <h1>Accepting an invitation is not available yet</h1>
    <p className="muted">When it is, this page will open the private link your cleaning business sent you. You can sign in or create an account from here later.</p>
    <p className="switch-copy"><a href="/sign-in?returnTo=%2Finvite">Sign in</a></p>
  </AuthShell>;
}
