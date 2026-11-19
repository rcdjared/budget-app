# My Budget App: Phase 0 starter

A minimal React + TypeScript + Vite + Tailwind PWA. Its only job is to prove the pipeline:
**Windows -> GitHub -> Vercel (HTTPS) -> iPhone home screen -> works offline.**

## 1. Install tools (Windows, one time)
- Node.js LTS: https://nodejs.org
- Git: https://git-scm.com
- VS Code: https://code.visualstudio.com
Check in PowerShell: `node -v` and `git -v`

## 2. Run it locally
```powershell
npm install
npm run dev
```
Open http://localhost:5173. You should see four checks. "Secure context" is ✅ on localhost.

## 3. Put it on GitHub
```powershell
git init
git add .
git commit -m "Phase 0 starter"
```
Create an empty repo on github.com, then follow its "push an existing repository" commands.

## 4. Deploy (free) for iPhone testing
Vercel: "Add New Project", import the GitHub repo, keep the defaults (it detects Vite), then Deploy.
You get an `https://....vercel.app` URL. Every `git push` redeploys automatically.

## 5. Install on iPhone
1. Open the URL in **Safari** (not Chrome).
2. Share button, then **Add to Home Screen**.
3. Open from the new icon. "Running as installed app" should turn ✅.
4. Enable airplane mode and reopen. The app should still load.

## Troubleshooting
- Offline fails on first try: open the app once while online, then close and reopen it, so the service worker can cache files.
- Icon didn't update: delete the home-screen icon and add it again (iOS caches icons hard).
- `npm install` errors: paste the full error to your AI assistant.

## What's next
See KICKOFF_PROMPT.md. Phase 1 is the data foundation (IndexedDB, integer-centavo money).
