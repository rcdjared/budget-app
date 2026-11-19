# UI_SPEC: Budget App (PWA, mobile-first)

Companion to `AGENT_SPEC.md`. This file defines **layout, components, tokens and interactions**. AGENT_SPEC defines features and data.
Source: layout patterns observed in screenshots of an existing budgeting app (dark theme only was observed). Replicate **layout patterns**, not branding: no copied mascot, logo, illustrations, bank logos or copy text. Use an original app name and character.

## 0. Rules for the agent
- Build mobile-first at 390px wide. On desktop, center the app in a max-width 480px column.
- Dark theme first. Build every color as a CSS variable so light and AMOLED themes are token swaps, not rewrites.
- Use Tailwind with the tokens below (define them in `index.css` under `@theme` or as CSS variables).
- Shared components go in `src/components/`. Do not duplicate card, pill, chip or row markup in features.
- No monetization UI: no "Pro", upgrade, lock or paywall elements anywhere.
- Light theme was not observed. Design it yourself using the same token names.

## 1. Design tokens

```css
:root {
  /* dark theme (default) */
  --bg:        #0A0E0D;   /* page */
  --surface:   #151B19;   /* cards */
  --surface-2: #1B2321;   /* nested/raised, chips */
  --border:    #232D2A;
  --text:      #F2F5F4;
  --text-muted:#8A9692;
  --accent:    #4F9A5B;   /* active, links, income, toggles on */
  --accent-soft: rgba(79,154,91,.16);  /* active tab pill, icon tiles */
  --income:    #4F9A5B;
  --expense:   #E5605A;
  --expense-soft: rgba(229,96,90,.16);
  --danger-bg: #3A1618;   /* reset button */
  --radius-card: 24px;
  --radius-field: 16px;
  --radius-pill: 999px;
  --space-page: 16px;     /* horizontal page padding (16-20) */
}
```
Themes to support: **System, Light, Dark, AMOLED** (AMOLED: `--bg:#000`, `--surface:#0B0F0E`). Accent color picker (default green). Persist choice in settings.

Colors are approximate, adjust by eye if needed.

**Typography:** rounded geometric sans (e.g. Nunito, Plus Jakarta Sans or DM Sans via self-hosted font to keep offline).
- Page title: 32-36px bold. Subtitle under it: 16px, `--text-muted`.
- Card title: 18-20px semibold. Body/notes: 14-16px `--text-muted`.
- Amounts: 20-32px bold, tabular numbers (`font-variant-numeric: tabular-nums`).
- **Eyebrow label:** 11-12px, uppercase, letter-spacing 0.1em, `--text-muted` (used for LAST 7 DAYS, NET WORTH, BALANCE, section headers in settings).

**Money display:** peso sign, thousands separators, 2 decimals. Expenses show a leading minus (`-₱1,175.59`), income a leading plus (`+₱8,042.33`).

**Icon tiles:** 48px rounded square (radius 16), tinted background in the category color at ~16% opacity, icon in the full color. Use an icon set such as lucide-react (loaded locally as a package).

## 2. Shared components

| Component | Spec |
|---|---|
| `Card` | `--surface`, radius 24, padding 16-20, no visible border (or 1px `--border`) |
| `IconButton` | 44-48px circle, `--surface`, icon in `--accent`. Used in headers and back buttons |
| `IconPill` | Pill container holding 2-3 `IconButton`-style icons side by side (header groups) |
| `Chip` | Small rounded rect, `--surface-2`, 12-13px text with tiny leading icon. Shows account name on rows |
| `TotalPill` | Rounded pill with colored background: expense (`--expense-soft` + red text), income (`--accent-soft` + green text). Used on History day headers |
| `Segmented` | Pill track with 2-3 options, selected option has solid `--accent` fill and white text. Used for Day/Week/Month and notification tabs |
| `Toggle` | 52x30 pill, on = `--accent`, off = gray. White thumb |
| `RowCard` | `Card` with left icon tile, title (semibold), description (muted, up to 2 lines), right chevron |
| `SectionLabel` | Eyebrow label above a group of rows |
| `TipCard` | Dismissible `RowCard`; small circular X button notched at the top-right corner |
| `MiniBars` | 7 vertical rounded bars with day initials below; today highlighted in `--accent`, empty days as small dots/muted bars |
| `TimelineRow` | See 4.2 |
| `Sheet/Popover` | Rounded 24px dark surface with 1px border, shadow; items separated by hairlines |

## 3. App shell

### 3.1 Bottom tab bar
- Floating **pill** bar inset from the screen edges (about 16px left/right, 12px above the bottom plus `env(safe-area-inset-bottom)`). Radius 999, `--surface` with 1px border.
- **5 items in order: Home, Wallet, Plan, History, Add.** Add is the **last (rightmost)** item, not centered.
- Each item: icon (24px) above a 12-13px label.
- Active item: a lighter pill (`--accent-soft`) behind icon and label, icon and label colored `--accent`. Inactive: white/muted.
- Scrollable pages need bottom padding so content clears the bar (about 112px).

### 3.2 Add menu
- Tapping **Add** toggles its icon from `+` to `X` and opens a popover anchored above the bar, aligned to the right, width about 60% of screen.
- Menu items (icon tile + title + optional muted subtitle):
  1. **Chat** (natural-language entry)
  2. **Transfer**
  3. **Scan receipt**, subtitle "Hold for camera"
  4. **Income**, subtitle "Hold for templates"
  5. **Expense**, subtitle "Hold for templates"
- Tap outside or the X closes it. The page behind stays visible and dimmed slightly.
- Long-press on Income or Expense opens the template list. Tap opens the quick add form.
- Setting: user can choose what the plus button does (open menu vs go straight to expense).

### 3.3 Header patterns (no title bar; icons float at top)
Top row height about 56px plus safe-area top. Left and right groups of circular buttons.

| Screen | Left | Right |
|---|---|---|
| Home | Streak button (flame icon + count) | IconPill: bell, profiles, settings |
| Wallet | Account/ID card button | Two circular buttons (e.g. manage/archive, add account) |
| Plan | none | IconPill: reports (document, chart) + circular guide/learn button |
| History | none | Search circle + IconPill: calendar (date range), filter |
| Settings and sub-pages | Circular back button | Page title centered |

## 4. Screens

### 4.1 Home (top to bottom)
1. **Header** (3.3).
2. **Status band:** full-bleed horizontal stripe in solid green (about 120px tall) across the screen. A character illustration overlaps the left edge and breaks out above the stripe. A **speech-bubble card** (dark surface, tail pointing to the character) sits on the right with a name label in green and 2-4 lines of text. Message is rule-based (example: spending exceeds logged income this month). Use an original character.
3. **Tip carousel:** horizontally swipeable `RowCard`s with a peek of the next card, and pagination dots below (active dot is a longer pill). Content: onboarding tips and feature highlights. No upgrade prompts.
4. **Two-card row** (50/50, gap 12):
   - Left `Card`: eyebrow "LAST 7 DAYS" + `MiniBars` (day initials F S S M T W T, today highlighted).
   - Right `Card`: title "Today", income line (green, up-trend icon), expense line (red, down-trend icon), and a `Segmented` Day / Week / Month that changes the period for these totals.
5. **TipCard** "Set your first budget" with pie icon tile; shown until a budget exists or user dismisses it.
6. **"View all >"** link, right aligned, green.
7. **Recent transactions** as a timeline grouped by day (4.2).
- User can show, hide and reorder sections 2 to 7 (Settings > Home).

### 4.2 Transaction timeline (Home and History)
- Day title ("Today", or a date) in bold 20px.
- Each row: a **time label** (e.g. "2:55 PM", muted) above the card, a vertical thin rail on the left with a **colored dot** (red expense, green income/system), then a `Card`:
  - Left: icon tile in category color.
  - Middle: title (category), muted note below (up to 2 lines).
  - Right: amount (red for expense, green for income) and an account `Chip` under it.
  - Far right: ⋮ menu (edit, duplicate, delete).
- **System rows** (e.g. Beginning balance): flag icon tile, line "Account • ₱0.00 to ₱8,000.00", green amount, trash icon instead of ⋮.
- Transfers use a neutral color and show "From > To" chips.

### 4.3 History
- Header (3.3). No page title.
- **Day group header:** collapse caret, "Today" with uppercase date below ("NOVEMBER 19, 2026"), then right-aligned `TotalPill`s: expense total (red) and income total (green). A hairline divides it from the rows.
- Groups are collapsible. Rows per 4.2.
- Search opens an inline search field. Calendar icon opens date-range picker. Filter icon opens a sheet (category, account, type, tags).
- Empty state: centered muted text, no illustration required.

### 4.4 Wallet
- Header (3.3).
- Title "Accounts" with subtitle "Manage your wallets and balances".
- **Net worth band:** same green stripe + character as Home, with a `Card` showing eyebrow "NET WORTH", large amount, and a small eye icon to hide/show amounts (privacy mode).
- **Two-card row:**
  - Insight card: eyebrow "INSIGHT" + link "Forecast cashflow >", 2-3 lines of rule-based text with key phrase in bold.
  - Daily balance card: eyebrow "DAILY BALANCE" + 7 vertical rounded bars with day initials.
- **Hint row:** muted text "Press and hold an account card to rearrange it" + grid/list toggle (two small icon buttons in a pill).
- **Account cards:** 2-column grid, equal height (about 150px), radius 24, **solid fill in the account's color** (gradient allowed), white text. Content: logo/initial badge top-left, name, ⋯ menu top-right, subtitle "Debit • PHP", eyebrow "BALANCE", large amount at the bottom. List view shows the same data as full-width rows.
- Use colored initial badges for banks. No third-party logos.
- **Recent income** section with "View all >" and timeline rows (4.2).
- Credit cards show available credit, statement balance and due date in place of plain balance.

### 4.5 Plan
- Header (3.3). Title "Plan", subtitle "Manage your budgets, goals, and more."
- **RowCards** (full width, icon tile, title, one-line description, chevron):
  1. Category budgets: "Set daily, weekly, bi-weekly, monthly, or annual limits."
  2. Personal goals: "Track savings goals and milestones."
  3. Debt: "Track money you still owe."
  4. Money owed to you: "Track what others still owe you."
  5. Planned payments: "Recurring and future one-time payments"
- **2x2 compact tile grid** (icon + label + chevron): Travel, Tags, Tools, Overview.
- Each destination is a sub-page with a back button header.

### 4.6 Add flows
- **Quick add (expense/income):** bottom sheet or full screen. Amount first (large display + numeric keypad), then category, account, date/time, note. Remember last-used account and category. Template chips at the top.
- **Chat:** chat-style input with confirmation card before saving (see AGENT_SPEC 6.3).
- **Transfer:** from-account, to-account, amount, date.
- **Scan receipt:** file input with `capture`, then prefilled form.
- **Undo:** after saving, show a toast with "Undo" for several seconds (shake-to-undo is optional).

### 4.7 Settings
- Page structure: back button + centered title, scrolling list of `SectionLabel` + `RowCard`s, and a **floating "Search settings" pill** fixed at the bottom (search icon + placeholder, radius 999, `--surface`). Tab bar is hidden on settings pages.
- Sections (in order observed): About card (app name, version chip, links), Updates, What's new, Send feedback, Privacy notice, Currency, Quick actions (deep links), Undo gesture toggle, Help guide, Home layout, Preferences, Security, Appearance, Statement PDF, Backup, Import, Local backup, Reset.
- **Preferences** includes: net worth rules, decimal display, budget cycle, haptics (hide on iOS web), plus-button action.
- **Security:** app lock toggle (PIN; passkey if feasible).
- **Appearance:** four mini-preview thumbnails (System half-light/half-dark, Light, Dark, AMOLED), selected one has a green outline; below it an "App color" row.
- **Backup group:** "Generate statement PDF" (expandable, monthly income, expenses, net income), "Manage your local backup" (export/restore JSON or CSV), "Import from other apps". iCloud toggle does not apply to a PWA, omit it.
- **Reset all data:** full-width button at the very bottom, `--danger-bg` background, red text and trash icon, requires a confirm dialog.
- Footer notes: a privacy notice card and a third-party trademarks disclaimer card (important if bank names are shown).

### 4.8 Profiles
- Page "Profiles": card "Local profiles" with a `1/4` count chip and dropdown caret; "Active profile name" field with Edit pill; "Preferred name" card ("Choose how the app refers to you").
- Max 4 local profiles. Cloud sign-in section appears only when the cloud phase is built (no upgrade or lock UI).

### 4.9 Notifications
- Page title "Notifications" with a two-option `Segmented` at the top: **Notifications** (inbox) and **Settings**.
- Settings tab: master toggle with a "Reminder time" row (chip showing 8:00 PM), then toggles: Daily follow-up, Budget alerts, Recurring items, Debts, Goals, Receivables.
- iOS PWA caveat: push needs an installed PWA and permission. Use an in-app inbox as the baseline.

## 5. Interaction patterns
- **Press and hold** a card or row to reorder (account cards) or open templates (Income/Expense). Implement with pointer events and a 400-500ms timer; add `-webkit-touch-callout:none; user-select:none; touch-action:manipulation` to avoid the iOS callout.
- **Swipe** only for the tip carousel (CSS scroll-snap, `overflow-x:auto`).
- **Collapsible day groups** with animated height.
- **Privacy mode:** eye icon masks amounts as `₱••••`.
- Motion: subtle (150-250ms). Respect `prefers-reduced-motion`.
- Use `dvh` units, safe-area insets, 44px minimum touch targets, no hover-only UI.

## 6. Streak and character (keep original)
- Header streak button shows a flame icon and the current streak count.
- A character band appears on Home and Wallet. Create an original mascot or use a simple coin character. Placeholder is acceptable: a green stripe with an emoji-sized or SVG coin character.
- Cosmetic unlocks (backgrounds, outfits) are optional and come last.

## 7. Build order for UI (maps to AGENT_SPEC phases)
1. Tokens, fonts, base components (Card, IconButton, IconPill, Chip, Toggle, Segmented, TotalPill).
2. App shell: tab bar, header slots, routing, safe areas, Add popover (empty actions).
3. Transaction timeline row and History screen with day groups.
4. Home sections, then Wallet (account cards, net worth).
5. Quick add, transfer flows.
6. Plan hub and sub-pages.
7. Settings pages and theme switching.
8. Polish: reorder, long-press, privacy mode, empty states, motion.

## 8. Definition of done (UI)
- All screens match the layout above at 390px and look correct at 360px and 430px.
- Contrast passes WCAG AA for text on every theme.
- Tab bar never covers content; safe-area padding verified on iPhone.
- Works as an installed PWA, with no browser chrome visible.