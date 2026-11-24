import type { SpendingPulseMood } from "./types";

export type KupiImageState = "idle" | "happy" | "worried" | "thinking" | "pointing";

export function getKupiImageSrc(mood: SpendingPulseMood, state?: KupiImageState): string {
  if (state) return `/icons/${state}.png`;
  if (mood === "smug" || mood === "proud") return "/icons/happy.png";
  if (mood === "shook" || mood === "side-eye") return "/icons/worried.png";
  return "/icons/idle.png";
}

export const KUPI_IMAGE_SRC = "/icons/idle.png";

export function Kupi({
  mood,
  size,
  state,
}: {
  mood: SpendingPulseMood;
  size: number;
  state?: KupiImageState;
}) {
  return (
    <img
      className="spending-pulse__mascot"
      src={getKupiImageSrc(mood, state)}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      alt={`Kupi looking ${mood}`}
    />
  );
}
