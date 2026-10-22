import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { ContractorLanding } from "@/components/contractor-landing";
import { auth } from "@/lib/auth";
import { contractorPageDestination, type AccountRole } from "@/lib/contractor-route-guard";
import { accountRole } from "@/services/invites";

export default async function ContractorPage() {
  let role: AccountRole | null = null;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user?.id) role = await accountRole(db, session.user.id);
  } catch {
    role = null;
  }
  const destination = contractorPageDestination(role);
  if (destination) redirect(destination);
  return <ContractorLanding />;
}
