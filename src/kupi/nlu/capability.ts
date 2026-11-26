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
  const minimumMemoryGiB = modelSize === "1.7B" ? 16 : 8;
  if (deviceMemoryGiB === undefined || deviceMemoryGiB < minimumMemoryGiB) {
    return {
      webgpu,
      adapterAvailable,
      deviceMemoryGiB,
      storageAvailableBytes,
      supported: false,
      reason: `The ${modelSize} offline model requires a device reporting at least ${minimumMemoryGiB} GB of memory. Use suggestions only on this device.`,
    };
  }
  if (storageAvailableBytes !== undefined && storageAvailableBytes < 2_500_000_000) {
    return { webgpu, adapterAvailable, deviceMemoryGiB, storageAvailableBytes, supported: false, reason: "This device has too little free browser storage for Smart mode." };
  }
  return { webgpu, adapterAvailable, deviceMemoryGiB, storageAvailableBytes, supported: true };
}
