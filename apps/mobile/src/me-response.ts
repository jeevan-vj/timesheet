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

export type ContractorLink = z.infer<typeof contractorLink>;

export type ViewerProfile = {
  role: ViewerRole;
  contractorOf: ContractorLink[];
};

export function readViewerProfile(body: unknown): ViewerProfile | null {
  const parsed = meResponseSchema.safeParse(body);
  if (!parsed.success) return null;
  return {
    role: viewerRole(parsed.data),
    contractorOf: parsed.data.contractorOf,
  };
}

export function readViewerRole(body: unknown): ViewerRole | null {
  return readViewerProfile(body)?.role ?? null;
}
