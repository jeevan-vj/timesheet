export type ContractorLink = {
  businessId: string;
  businessName: string;
};

export type ViewerShape = {
  owner: unknown;
  contractorOf: ContractorLink[];
};

export function landingPath(viewer: ViewerShape): "/dashboard" | "/portal" {
  if (viewer.owner === null && viewer.contractorOf.length > 0) return "/portal";
  return "/dashboard";
}

export function showsRoleSwitcher(viewer: ViewerShape): boolean {
  return viewer.owner !== null && viewer.contractorOf.length > 0;
}

export function asViewerShape(value: unknown): ViewerShape {
  if (!value || typeof value !== "object") return { owner: null, contractorOf: [] };
  const record = value as { owner?: unknown; contractorOf?: unknown };
  const links = Array.isArray(record.contractorOf) ? record.contractorOf.flatMap(linkFromUnknown) : [];
  return { owner: record.owner ?? null, contractorOf: links };
}

function linkFromUnknown(value: unknown): ContractorLink[] {
  if (!value || typeof value !== "object") return [];
  const record = value as { businessId?: unknown; businessName?: unknown };
  if (typeof record.businessId !== "string" || typeof record.businessName !== "string") return [];
  return [{ businessId: record.businessId, businessName: record.businessName }];
}
