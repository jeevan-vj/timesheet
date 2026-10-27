import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => {
  const remove = vi.fn();
  return {
    remove,
    getNetworkStateAsync: vi.fn(async () => ({ isConnected: true, isInternetReachable: true })),
    addNetworkStateListener: vi.fn(() => ({ remove })),
  };
});

vi.mock("expo-network", () => ({
  getNetworkStateAsync: network.getNetworkStateAsync,
  addNetworkStateListener: network.addNetworkStateListener,
}));

const { bindOnlineManager, networkIsOnline } = await import("../apps/mobile/src/online.ts");

afterEach(() => {
  onlineManager.setOnline(true);
  onlineManager.setEventListener(() => undefined);
  vi.unstubAllGlobals();
  network.remove.mockClear();
  network.addNetworkStateListener.mockClear();
  network.getNetworkStateAsync.mockReset();
  network.getNetworkStateAsync.mockResolvedValue({ isConnected: true, isInternetReachable: true });
});

describe("bindOnlineManager", () => {
  it("does not throw when React Native window has no addEventListener", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { product: "ReactNative" });
    const cleanup = bindOnlineManager();
    expect(network.addNetworkStateListener).toHaveBeenCalledTimes(1);
    expect(() => cleanup()).not.toThrow();
    expect(() => cleanup()).not.toThrow();
    expect(network.remove).toHaveBeenCalledTimes(1);
  });

  it("adds and removes browser listeners when those methods exist", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("window", { addEventListener, removeEventListener });
    vi.stubGlobal("navigator", { onLine: true });
    const cleanup = bindOnlineManager();
    const online = addEventListener.mock.calls.find((call) => call[0] === "online")?.[1];
    const offline = addEventListener.mock.calls.find((call) => call[0] === "offline")?.[1];
    expect(typeof online).toBe("function");
    expect(typeof offline).toBe("function");
    cleanup();
    expect(removeEventListener).toHaveBeenCalledWith("online", online);
    expect(removeEventListener).toHaveBeenCalledWith("offline", offline);
    expect(network.remove).toHaveBeenCalledTimes(1);
  });

  it("keeps the device online when the network read fails and navigator.onLine is missing", async () => {
    network.getNetworkStateAsync.mockRejectedValueOnce(new Error("unavailable"));
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {});
    onlineManager.setOnline(false);
    const cleanup = bindOnlineManager();
    await expect(network.getNetworkStateAsync.mock.results[0]?.value).rejects.toThrow("unavailable");
    expect(onlineManager.isOnline()).toBe(true);
    cleanup();
  });

  it("uses navigator.onLine only when it is a boolean", async () => {
    network.getNetworkStateAsync.mockRejectedValueOnce(new Error("unavailable"));
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal("navigator", { onLine: false });
    onlineManager.setOnline(true);
    const cleanup = bindOnlineManager();
    await expect(network.getNetworkStateAsync.mock.results[0]?.value).rejects.toThrow("unavailable");
    expect(onlineManager.isOnline()).toBe(false);
    cleanup();
  });
});

describe("networkIsOnline", () => {
  it("treats a missing snapshot as online and an explicit disconnect as offline", () => {
    expect(networkIsOnline({})).toBe(true);
    expect(networkIsOnline({ isConnected: false, isInternetReachable: true })).toBe(false);
    expect(networkIsOnline({ isConnected: true, isInternetReachable: false })).toBe(false);
  });
});
