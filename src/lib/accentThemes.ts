export const ACCENT_THEMES = [
  { id: "sage", name: "Sage", color: "#3B7A5F", darkColor: "#9CC7A8" },
  { id: "ocean", name: "Ocean tide", color: "#2F6F8F", darkColor: "#8EC3DB" },
  { id: "lagoon", name: "Lagoon", color: "#1F7A7A", darkColor: "#86CFCB" },
  { id: "coral", name: "Coral reef", color: "#BC5144", darkColor: "#F0A596" },
  { id: "honey", name: "Honey", color: "#8F5F14", darkColor: "#EBC36B" },
  { id: "lavender", name: "Lavender dusk", color: "#6B5CA5", darkColor: "#BBAEE3" },
] as const;

export type AccentThemeId = (typeof ACCENT_THEMES)[number]["id"];

export function getAccentTheme(value: string | null | undefined) {
  return ACCENT_THEMES.find(
    (theme) => theme.id === value || theme.name.toLowerCase() === value?.toLowerCase(),
  ) ?? ACCENT_THEMES[0];
}
