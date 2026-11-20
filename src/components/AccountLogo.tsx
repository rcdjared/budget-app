import { useEffect, useState } from "react";
import { Banknote, Landmark, Wallet } from "lucide-react";
import { ACCOUNT_TEMPLATES } from "@/db/seed";

const legacyLogoAliases: Record<string, string> = {
  gotyme: "gotyme.png",
  landbank: "landbank.png",
  eastwest: "eastwest.png",
  seabank: "maribank.png",
};

export function getAccountLogoFilename(name: string): string | undefined {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ACCOUNT_TEMPLATES.find((item) => item.name.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized)?.logo
    || legacyLogoAliases[normalized]
    || undefined;
}

export function AccountLogo({
  name,
  filename,
  color = "#019B51",
  type = "bank",
  size = 42,
}: {
  name: string;
  filename?: string;
  color?: string;
  type?: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const logo = filename ?? getAccountLogoFilename(name);
  useEffect(() => setFailed(false), [logo]);
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "BK";
  const FallbackIcon = type === "cash" ? Banknote : type === "ewallet" ? Wallet : Landmark;

  return (
    <span
      role="img"
      className={`institution-logo ${failed || !logo ? "fallback" : ""}`}
      style={{ width: size, height: size, color, backgroundColor: failed || !logo ? `${color}18` : "transparent" }}
      aria-label={`${name} logo`}
      title={name}
    >
      {logo && !failed ? (
        <img src={`/icons/banks/${logo}`} alt="" onError={() => setFailed(true)} />
      ) : (
        <>
          <FallbackIcon size={Math.max(15, size * 0.42)} strokeWidth={1.9} />
          <b>{initials}</b>
        </>
      )}
    </span>
  );
}
