import { LegalPage } from "@/components/legal-page";

export const metadata = {
  title: "Terms of Service — CleanTrack",
  description: "Terms for using CleanTrack contractor-hours and weekly-pay services.",
};

export default function TermsPage() {
  return (
    <LegalPage effectiveDate="30 October 2026" title="Terms of Service">
      <p>These terms govern access to CleanTrack. By creating an account or accepting an invitation, you agree to use the service under these terms.</p>

      <section>
        <h2>Accounts and authorised use</h2>
        <p>You must provide accurate account information, protect your sign-in credentials, and promptly report suspected unauthorised access. Business owners may invite contractors and are responsible for ensuring that they have authority to enter and manage business, contractor, work, and payment information.</p>
      </section>

      <section>
        <h2>Owner and contractor responsibilities</h2>
        <p>Owners are responsible for assignments, recorded work, rates, approvals, and payment decisions. Contractors are responsible for reviewing the work and remittance information made available to them and raising discrepancies with the business owner. Users must not access another business’s data or misuse invitations or accounts.</p>
      </section>

      <section>
        <h2>Payment information</h2>
        <p>CleanTrack calculates gross contractor payment information from recorded minutes and snapshotted rates. It does not pay contractors and does not provide tax, GST, employment, legal, or accounting advice. Users remain responsible for verifying records and meeting their own payment and legal obligations.</p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>You must not interfere with the service, attempt to bypass access controls, upload unlawful or malicious material, probe other accounts, or use CleanTrack in a way that violates applicable law or another person’s rights.</p>
      </section>

      <section>
        <h2>Availability and account action</h2>
        <p>We may change, suspend, or discontinue features and may restrict access when reasonably necessary for security, maintenance, legal compliance, or misuse. The service is provided on an “as available” basis, and uninterrupted or error-free operation is not guaranteed.</p>
      </section>

      <section>
        <h2>Contact and changes</h2>
        <p>Questions about these terms may be sent to <a href="mailto:jeevan90wijerathna@gmail.com">jeevan90wijerathna@gmail.com</a>. We may update these terms as CleanTrack changes and will publish the revised effective date here.</p>
      </section>
    </LegalPage>
  );
}
