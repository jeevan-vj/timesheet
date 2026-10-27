import { portalQueryPersists } from "@cleantrack/core/portal";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, type QueryClient as QueryClientType } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useEffect, type ReactNode } from "react";
import { bindOnlineManager } from "@/online";

const WEEK_MS = 1000 * 60 * 60 * 24 * 7;

const storage = {
  getItem: (key: string) => {
    if (typeof window === "undefined") return Promise.resolve(null);
    return AsyncStorage.getItem(key);
  },
  setItem: (key: string, value: string) => {
    if (typeof window === "undefined") return Promise.resolve();
    return AsyncStorage.setItem(key, value);
  },
  removeItem: (key: string) => {
    if (typeof window === "undefined") return Promise.resolve();
    return AsyncStorage.removeItem(key);
  },
};

export const portalQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 60_000,
    },
  },
});

portalQueryClient.setQueryDefaults(["portal-week"], { gcTime: WEEK_MS });
portalQueryClient.setQueryDefaults(["portal-upcoming"], { gcTime: WEEK_MS });

const persister = createAsyncStoragePersister({
  storage,
  key: "cleantrack-portal-cache",
});

const persistOptions = {
  persister,
  maxAge: WEEK_MS,
  buster: "portal-v1",
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { queryKey: readonly unknown[] }) => portalQueryPersists(query.queryKey),
  },
};

export function clearStoredPortalCache(client: QueryClientType = portalQueryClient): void {
  client.clear();
  void persister.removeClient();
}

export function PortalQueryProvider({ children }: { children: ReactNode }) {
  useEffect(() => bindOnlineManager(), []);
  return (
    <PersistQueryClientProvider client={portalQueryClient} persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  );
}
