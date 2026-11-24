export interface SmartCapability {
  webgpu: boolean;
  adapterAvailable: boolean;
  deviceMemoryGiB?: number;
  storageAvailableBytes?: number;
  supported: boolean;
  reason?: string;
}

export async function detectSmartCapability(modelSize: "0.6B" | "1.7B" = "0.6B"): Promise<SmartCapability> {
  const nav = typeof navigator === "undefined" ? undefined : navigator as Navigator & {
    gpu?: { requestAdapter: () => Promise<unknown | null> };
    deviceMemory?: number;
  };
  const webgpu = Boolean(nav?.gpu);
  let adapterAvailable = false;
  try { adapterAvailable = Boolean(await nav?.gpu?.requestAdapter()); } catch { /* The GPU can be blocked or unavailable. */ }
  const deviceMemoryGiB = nav?.deviceMemory;
  let storageAvailableBytes: number | undefined;
  try {
    const estimate = await navigator.storage?.estimate();
    if (estimate?.quota !== undefined) {
      storageAvailableBytes = Math.max(0, estimate.quota - (estimate.usage ?? 0));
    }
  } catch {
    // Storage estimates are optional browser hints.
  }
  if (!webgpu || !adapterAvailable) return { webgpu, adapterAvailable, deviceMemoryGiB, storageAvailableBytes, supported: false, reason: "A usable WebGPU adapter is not available in this browser." };
  if (deviceMemoryGiB !== undefined && deviceMemoryGiB < 4) {
    return { webgpu, adapterAvailable, deviceMemoryGiB, storageAvailableBytes, supported: false, reason: "This device reports less than 4 GB of system memory." };
  }
  if (modelSize === "1.7B" && deviceMemoryGiB !== undefined && deviceMemoryGiB < 8) {
    return { webgpu, adapterAvailable, deviceMemoryGiB, storageAvailableBytes, supported: false, reason: "The 1.7B model needs a device reporting at least 8 GB of memory. Choose 0.6B or use suggestions only." };
  }
  if (storageAvailableBytes !== undefined && storageAvailableBytes < 2_500_000_000) {
    return { webgpu, adapterAvailable, deviceMemoryGiB, storageAvailableBytes, supported: false, reason: "This device has too little free browser storage for Smart mode." };
  }
  return { webgpu, adapterAvailable, deviceMemoryGiB, storageAvailableBytes, supported: true };
}
