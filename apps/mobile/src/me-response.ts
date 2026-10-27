import { z } from "zod";
import { viewerRole, type ViewerRole } from "./api-config";

const contractorLink = z.object({
  businessId: z.string(),
  businessName: z.string(),
});

export const meResponseSchema = z.object({
  owner: z.unknown().nullable(),
  contractorOf: z.array(contractorLink),
});

export function readViewerRole(body: unknown): ViewerRole | null {
  const parsed = meResponseSchema.safeParse(body);
  if (!parsed.success) return null;
  return viewerRole(parsed.data);
}
