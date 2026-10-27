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

function browserOnLine(): boolean | null {
  if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") return null;
  return navigator.onLine;
}

// React Native sets window to globalThis and does not implement DOM events.
function browserCanListen(): boolean {
  return typeof window?.addEventListener === "function" && typeof window?.removeEventListener === "function";
}

export function bindOnlineManager(): () => void {
  onlineManager.setEventListener((setOnline) => {
    let subscription: { remove: () => void } | null = null;
    void Network.getNetworkStateAsync()
      .then((state) => setOnline(networkIsOnline(state)))
      .catch(() => {
        const online = browserOnLine();
        setOnline(online === null ? true : online);
      });
    try {
      subscription = Network.addNetworkStateListener((state) => {
        setOnline(networkIsOnline(state));
      });
    } catch {
      subscription = null;
    }
    const onBrowser = () => {
      const online = browserOnLine();
      if (online !== null) setOnline(online);
    };
    if (browserCanListen()) {
      window.addEventListener("online", onBrowser);
      window.addEventListener("offline", onBrowser);
    }
    return () => {
      subscription?.remove();
      if (browserCanListen()) {
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
