# BRAND.md: Kupit "Sand & Shell" rebrand

Agent-readable brand and theme rules. **This file overrides section 1 (tokens) of `UI_SPEC.md`.** The old dark-green palette from the first reference app is retired. Layout rules in UI_SPEC still apply unless noted here.

## 1. Direction
- Mood: calm beach morning. Warm sand and cream surfaces, soft seafoam, a little coral and gold. Pastel surfaces, **never neon**.
- Mascot: Kupi the crab (coral body, gold "K" coin). The coin is the brand symbol.
- Original IP only. A beach/sandy vibe is fine. Do not use SpongeBob, Krusty Krab or any other franchise characters, logos, fonts or lookalike artwork.

## 2. Palette (surfaces in `theme-cozy.css`, accents in `theme-accents.css`)

| Token | Cozy light (default) | Cozy dark | Use |
|---|---|---|---|
| `--background` | #F6EFE2 | #211B15 | page |
| `--card` | #FFFBF2 | #2C251D | cards, sheets |
| `--muted` / `--secondary` | #EFE5D2 | #372F25 | chips, inputs, tracks |
| `--border` | #E3D6BE | #45392D | hairlines |
| `--foreground` | #3A2F25 | #F5EDE0 | main text |
| `--muted-foreground` | #6F6050 | #BDB09C | secondary text |
| `--primary` | #3B7A5F | #9CC7A8 | buttons, active, links (default Sage) |
| `--primary-foreground` | #FFFFFF | #1C2A21 | text on primary |
| `--income` | #2A7A57 | #9CCBA6 | income amounts |
| `--expense` | #BE4B3B | #EE9F8F | expense amounts, destructive |
| `--warning` | #946514 | #D7B16E | near budget limit |
| `--kupit-gold` | #F2C14E | #F0C36A | coin, streak, Add button |

AMOLED = Dusk with `--background:#000` and slightly darker cards (class `amoled` on top of `dark`).

## 3. Rules for the agent
1. **No hex colors in components.** Use tokens (`var(--primary)`, Tailwind `bg-card`, etc.). Add neutral tokens to `theme-cozy.css` and accent tokens to `theme-accents.css`.
2. **Text on `--primary` uses `--primary-foreground`**, never `white`.
3. **Pastel for fills, mid-tone for text and icons.** Contrast must be at least 4.5:1 for text and 3:1 for icons and bars. Do not put pastel text on pastel backgrounds.
4. Max one saturated element per screen (the hero card or the gold Add button). Everything else stays soft.
5. Shadows are warm: `rgb(var(--shadow-rgb) / alpha)`, never pure black in light mode.
6. Income is jade, expense is coral. Do not use red/green alone to carry meaning; keep the +/- sign.

## 4. Category colors (pastel tile + mid-tone icon)
Tile background = color at 16% opacity. Icon = the full color.

| Name | Hex | Name | Hex |
|---|---|---|---|
| Coral | #D9776A | Sea | #5E9BB0 |
| Apricot | #E09A5B | Sky | #7C9FD0 |
| Gold | #D4A73C | Lavender | #9C8CC4 |
| Olive | #8FA35A | Orchid | #B97FA8 |
| Jade | #4F9D7E | Clay | #B5846A |
| Sand brown | #A68B66 | Slate | #7F8C8D |

## 5. Typography
- Current: Geist Variable (fine). Optional friendlier option: **Nunito** (rounded) via `@fontsource-variable/nunito`. Do not use cartoonish display fonts.

## 6. PWA branding updates
- `vite.config.ts` manifest: `theme_color: "#F6EFE2"`, `background_color: "#F6EFE2"`.
- `index.html`:
```html
<meta name="theme-color" content="#F6EFE2" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#1B1713" media="(prefers-color-scheme: dark)" />
```
- App icon: keep the green coin + crab icon (recognizable on the home screen). Optional: a cream-background variant for light splash screens.

## 7. Make the UX feel original (optional, pick any)
- **Tide bar:** budgets shown as water level (a wave fill that drains as you spend) instead of a plain progress bar.
- **Kupi moods:** happy, worried, sleepy crab states driven by budget health and streak.
- **Coin stack goals:** savings goals show a growing stack of coins.
- **Gold coin Add button** (already in the theme file).
- Playful empty states in Taglish ("Wala pang gastos. Suspiciously disciplined.").

## 8. Done when
- Light, Dark and AMOLED all render with no leftover bright green or pure-white hardcodes.
- Contrast checks pass on Home, History, Wallet, Plan, Settings.
- Installed PWA status bar and splash match the new background.

## 9. Cozy layer (`theme-cozy.css`, loaded after app styles)
Goal: feel like a seaside cafe, not a sci-fi dashboard. These rules override section 2 values where they differ.
- Accent is **sage** (`#3B7A5F` light, `#9CC7A8` dark). No vivid or neon green anywhere.
- Dark mode is warm **driftwood brown** (`#211B15` page, `#2C251D` cards), never near-black or green-tinted. AMOLED stays pure black.
- No glows, no tinted outlines, no glassy edges. Cards are flat (tone only); only floating elements (tab bar, popups) get a soft warm shadow.
- Labels are sentence case at 12px or larger. No tiny tracked-out UPPERCASE labels.
- Titles and big amounts use **Fraunces** (soft serif); body uses **Nunito**. Verify the peso sign renders well.
- Corners are generous (`--radius: 1.25rem`). Progress bars are chunky (10px).
- Speech bubbles use a warm paper tint with no outline.
- The "App color" setting must offer muted presets only, with a separate lighter variant for dark mode.

## 10. Accent themes (`theme-accents.css`)
- Default accent is sage. Alternatives: `ocean`, `lagoon`, `coral`, `honey`, `lavender`, selected with `document.documentElement.dataset.accent`.
- The Settings > Appearance "App color" picker must set this attribute (and persist it). It must **not** write `--primary` inline, because inline styles override the theme and break dark mode contrast.
- Neutrals (sand, driftwood) never change with the accent. Only action colors do.
- `coral` swaps expenses to plum so they stay distinct from the primary color.
