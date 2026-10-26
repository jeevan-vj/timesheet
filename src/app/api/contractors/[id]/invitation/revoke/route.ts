import { db } from "@/db/client";
import { runInvitation } from "@/lib/invitation-http";
import { revokeContractorInvitation } from "@/services/invitations";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return runInvitation(request, context.params, true, (userId, contractorId) => (
    revokeContractorInvitation(db, userId, contractorId)
  ));
}
