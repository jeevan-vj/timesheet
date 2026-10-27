import {
  portalPaymentDetailSchema,
  portalPaymentsSchema,
  portalUpcomingSchema,
  portalWeekSchema,
  type PortalPaymentDetail,
  type PortalPayments,
  type PortalUpcoming,
  type PortalWeek,
} from "@cleantrack/core/portal";
import { useQuery } from "@tanstack/react-query";
import type { ZodType } from "zod";
import { mobileFetch } from "@/api";

async function readPortal<T>(path: string, schema: ZodType<T>): Promise<T> {
  const response = await mobileFetch(path);
  if (!response.ok) throw new Error("portal_unavailable");
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new Error("portal_unavailable");
  return parsed.data;
}

export function usePortalWeek(weekStart: string) {
  return useQuery({
    queryKey: ["portal-week", weekStart],
    queryFn: () => readPortal<PortalWeek>(`/api/portal/week?week=${encodeURIComponent(weekStart)}`, portalWeekSchema),
  });
}

export function usePortalUpcoming() {
  return useQuery({
    queryKey: ["portal-upcoming"],
    queryFn: () => readPortal<PortalUpcoming>("/api/portal/upcoming?days=14", portalUpcomingSchema),
  });
}

export function usePortalPayments(weekStart: string) {
  return useQuery({
    queryKey: ["portal-payments", weekStart],
    queryFn: () => readPortal<PortalPayments>(`/api/portal/payments?week=${encodeURIComponent(weekStart)}`, portalPaymentsSchema),
  });
}

export function usePortalPaymentDetail(weekStart: string | null) {
  return useQuery({
    queryKey: ["portal-payment", weekStart],
    enabled: weekStart != null,
    queryFn: () => readPortal<PortalPaymentDetail>(`/api/portal/payments/${weekStart}`, portalPaymentDetailSchema),
  });
}
