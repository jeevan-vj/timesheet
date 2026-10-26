import { db } from "@/db/client";
import { runInvitation } from "@/lib/invitation-http";
import { getBetterAuthUrl } from "@/lib/runtime-env";
import { resendContractorInvitation } from "@/services/invitations";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return runInvitation(request, context.params, true, (userId, contractorId) => (
    resendContractorInvitation(db, userId, contractorId, getBetterAuthUrl())
  ));
}
