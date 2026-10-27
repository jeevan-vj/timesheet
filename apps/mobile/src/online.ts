import { onlineManager } from "@tanstack/react-query";
import * as Network from "expo-network";
import { useEffect, useState } from "react";

type NetworkSnapshot = {
  isConnected?: boolean;
  isInternetReachable?: boolean | null;
};

export function networkIsOnline(state: NetworkSnapshot): boolean {
  if (state.isConnected === false) return false;
  if (state.isInternetReachable === false) return false;
  return true;
}

export function bindOnlineManager(): () => void {
  onlineManager.setEventListener((setOnline) => {
    let subscription: { remove: () => void } | null = null;
    void Network.getNetworkStateAsync()
      .then((state) => setOnline(networkIsOnline(state)))
      .catch(() => {
        setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
      });
    try {
      subscription = Network.addNetworkStateListener((state) => {
        setOnline(networkIsOnline(state));
      });
    } catch {
      subscription = null;
    }
    const onBrowser = () => {
      if (typeof navigator !== "undefined") setOnline(navigator.onLine);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("online", onBrowser);
      window.addEventListener("offline", onBrowser);
    }
    return () => {
      subscription?.remove();
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onBrowser);
        window.removeEventListener("offline", onBrowser);
      }
    };
  });
  return () => {
    onlineManager.setEventListener(() => undefined);
  };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => onlineManager.isOnline());
  useEffect(() => onlineManager.subscribe(setOnline), []);
  return online;
}
