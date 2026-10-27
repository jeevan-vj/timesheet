import { db } from "@/db/client";
import { runInvitation } from "@/lib/invitation-http";
import { getBetterAuthUrl } from "@/lib/runtime-env";
import { createContractorInvitation, getContractorInvitation } from "@/services/invitations";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return runInvitation(request, context.params, false, (userId, contractorId) => (
    getContractorInvitation(db, userId, contractorId)
  ));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return runInvitation(request, context.params, true, (userId, contractorId) => (
    createContractorInvitation(db, userId, contractorId, getBetterAuthUrl())
  ), 201);
}
