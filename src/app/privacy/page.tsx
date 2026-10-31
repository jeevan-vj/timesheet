import { LegalPage } from "@/components/legal-page";

export const metadata = {
  title: "Privacy Policy — CleanTrack",
  description: "How CleanTrack collects, uses, and protects account and contractor-work information.",
};

export default function PrivacyPage() {
  return (
    <LegalPage effectiveDate="30 October 2026" title="Privacy Policy">
      <p>CleanTrack is a private contractor-hours and weekly-pay service for cleaning businesses. This policy explains what information CleanTrack handles and why.</p>

      <section>
        <h2>Information we collect</h2>
        <p>We collect account information such as your name and email address, business and site information, contractor contact and engagement details, assignments, schedules, time entries, rates, and weekly payment records entered by authorised users.</p>
        <p>If you choose Sign in with Google, Google provides CleanTrack with your basic profile information, including your name and verified email address. CleanTrack does not receive your Google password.</p>
      </section>

      <section>
        <h2>How we use information</h2>
        <p>We use this information to authenticate users, provide owner and contractor workspaces, calculate gross contractor payments from recorded hours and snapshotted rates, send invitations, secure the service, troubleshoot failures, and meet legal obligations.</p>
      </section>

      <section>
        <h2>Sharing and service providers</h2>
        <p>CleanTrack does not sell personal information. We disclose information only as needed to operate the service, comply with law, protect users or the service, or with the relevant account holder’s direction. Infrastructure, authentication, email, mobile-distribution, and monitoring providers may process limited information on our behalf under their own security and privacy commitments.</p>
      </section>

      <section>
        <h2>Storage, retention, and security</h2>
        <p>We use access controls, owner-scoped records, encrypted connections, and operational safeguards intended to protect information. No system is completely secure. We retain information while it is needed to provide the service, maintain business and payroll history, resolve disputes, or meet legal requirements.</p>
      </section>

      <section>
        <h2>Your choices</h2>
        <p>You may use email and password instead of Google sign-in. You can ask to access, correct, or delete personal information, subject to account ownership, payroll-record, security, and legal retention requirements. Business owners are responsible for requests concerning contractor records they manage in CleanTrack.</p>
      </section>

      <section>
        <h2>Contact and updates</h2>
        <p>For privacy questions or requests, email <a href="mailto:jeevan90wijerathna@gmail.com">jeevan90wijerathna@gmail.com</a>. We may update this policy as the service changes and will publish the revised effective date here.</p>
      </section>
    </LegalPage>
  );
}
