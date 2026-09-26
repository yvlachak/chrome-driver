# Example tasks

Start with read-only or low-impact workflows while validating a site.

```powershell
npm run dev -- run --start https://example.com --goal "Open the More information link and tell me the final page title."
```

```powershell
npm run dev -- run --start https://news.ycombinator.com --goal "Open the first story and tell me its title."
```

For a persistent authenticated workflow, use a dedicated profile directory:

```powershell
npm run dev -- run --profile .chrome-driver/work-profile --start https://your-app.example --goal "Open the dashboard and find the newest pending item."
```

Use `--yes` only when you intentionally want unattended approval of the narrow deterministic high-impact click guard.
