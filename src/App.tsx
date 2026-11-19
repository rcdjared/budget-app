import { useEffect, useState } from "react";

// Phase 0 goal: prove the pipeline works end to end:
// code on Windows -> deployed over HTTPS -> installed on iPhone -> works offline.
// This screen reports each of those checks so you can SEE them pass.

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function Check({ ok, label, hint }: { ok: boolean | null; label: string; hint?: string }) {
  return (
    <li className="flex gap-3 rounded-xl bg-white p-4 shadow-sm">
      <span className="text-xl">{ok === null ? "…" : ok ? "✅" : "❌"}</span>
      <div>
        <p className="font-medium">{label}</p>
        {hint && <p className="text-sm text-gray-500">{hint}</p>}
      </div>
    </li>
  );
}

export default function App() {
  const online = useOnline();
  const [persisted, setPersisted] = useState<boolean | null>(null);

  // "Standalone" = launched from the home screen icon (no Safari toolbar).
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;

  const secure = window.isSecureContext; // true on HTTPS (and localhost)

  useEffect(() => {
    // Asks the browser not to evict our local data when storage is low.
    // We'll rely on this in Phase 1 when we store money data in IndexedDB.
    navigator.storage?.persist?.().then(setPersisted).catch(() => setPersisted(false));
  }, []);

  return (
    <main className="mx-auto max-w-md p-5">
      <h1 className="mb-1 text-2xl font-bold text-emerald-800">My Budget App</h1>
      <p className="mb-5 text-gray-600">Phase 0: setup check</p>

      <ul className="space-y-3">
        <Check ok={secure} label="Secure context (HTTPS)" hint="Required for service workers and installing." />
        <Check ok={online} label={online ? "Online" : "Offline: and still working!"} hint="Turn on airplane mode after installing, then reopen the app." />
        <Check ok={standalone} label="Running as installed app" hint="Share, then Add to Home Screen, then open from the icon." />
        <Check ok={persisted} label="Persistent storage granted" hint="May be denied in a normal Safari tab; installed apps do better." />
      </ul>
    </main>
  );
}
