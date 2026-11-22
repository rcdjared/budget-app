import type { SpendingPulseMood } from "./types";

export const KUPI_IMAGE_SRC = "/kupi-mascot.svg";

export function Kupi({ mood, size }: { mood: SpendingPulseMood; size: number }) {
  return (
    <img
      className="spending-pulse__mascot"
      src={KUPI_IMAGE_SRC}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      alt={`Kupi looking ${mood}`}
    />
  );
}
