# chrome-driver

A local-first Playwright browser agent whose planner is **Gemini Nano running natively inside Google Chrome** through Chrome's built-in Prompt API.

The design keeps the model inside Chrome and Playwright in Node.js. There is no OpenAI/Anthropic/Gemini cloud API, no model API key, and model output is never executed as arbitrary JavaScript.

## How it works

1. Chrome Driver launches installed **Google Chrome** using Playwright's `channel: "chrome"` with a persistent profile.
2. A localhost top-level page initializes Chrome's built-in `LanguageModel` / Gemini Nano session.
3. A separate target tab is observed through Playwright.
4. Chrome Driver gives Gemini Nano bounded visible text plus deterministic refs for visible interactive elements.
5. Gemini Nano returns exactly one JSON-schema-constrained action.
6. A deterministic executor maps that action to Playwright and repeats until the goal is complete, blocked, or the step budget is exhausted.

```text
natural-language goal
        |
        v
+----------------------+       compact page state       +-------------------------+
| Playwright / Node.js | ------------------------------> | Chrome LanguageModel     |
| deterministic driver |                                 | Gemini Nano, on-device  |
|                      | <------------------------------ | constrained JSON action |
+----------+-----------+                                 +-------------------------+
           |
           v
     target browser tab
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design details.

## Requirements

Chrome's current Prompt API documentation lists these relevant requirements for foundation-model APIs:

- a supported desktop Google Chrome build (the Prompt API is listed for the web beginning with Chrome 148)
- Windows 10/11, macOS 13+, Linux, or supported Chromebook Plus hardware
- at least 22 GB free on the volume containing the Chrome profile
- CPU path: at least 16 GB RAM and 4 CPU cores, or GPU path: strictly more than 4 GB VRAM
- an unmetered connection for the initial model download

After the model is downloaded, Chrome documents inference as local with no prompt data sent to Google or a third party by the on-device model.

Reference: https://developer.chrome.com/docs/ai/prompt-api

You also need Node.js 20+ and Google Chrome installed.

## Install

```powershell
git clone https://github.com/yvlachak/chrome-driver.git
cd chrome-driver
npm install
npm run build
```

This project intentionally uses installed branded Chrome rather than Playwright's bundled Chromium because the built-in Gemini Nano API belongs to Chrome.

## First-run check

```powershell
npm run doctor
```

`doctor` opens Chrome, loads the localhost inference host, checks `LanguageModel.availability()`, and clicks the initialization control. On first use Chrome may download the on-device model; subsequent runs reuse the persistent `.chrome-driver/profile` directory.

You can inspect Chrome's on-device model state at `chrome://on-device-internals`.

## Run an agent

```powershell
npm run dev -- run `
  --start https://example.com `
  --goal "Open the More information link and tell me the title of the destination page."
```

Or after `npm run build`:

```powershell
node dist/cli.js run --start https://example.com --goal "Open the More information link and tell me the final page title."
```

Useful flags:

```text
--profile PATH    persistent Chrome profile directory
--max-steps N     maximum model/action turns (default 25)
--yes             auto-approve the narrow high-impact click guard
--headless        use Chrome headless; headed mode is recommended for initial validation
--port N          pin the localhost inference-host port
```

## Action protocol

Gemini Nano can request only these actions:

- `navigate`
- `click`
- `fill`
- `press`
- `select`
- `scroll`
- `wait`
- `back`
- `finish`
- `handoff`

Structured output is enforced with the Prompt API `responseConstraint` JSON Schema. Element interactions must use a ref from the current page observation; refs are rebuilt after every turn.

## Safety model

The default executor has three hard boundaries:

1. model text is data, never code; there is no `eval`, generated JavaScript execution, shell tool, or arbitrary Playwright method dispatch;
2. navigation is limited to HTTP(S);
3. a deterministic text guard requests confirmation before a small class of high-impact clicks such as purchases, fund transfers, destructive account actions, publishing, and sending email.

For trusted unattended workflows, `--yes` bypasses the confirmation prompt. Site-specific allowlists and stronger transaction policies should be added before production use.

## Profiles and authenticated sites

The default profile is dedicated to Chrome Driver:

```text
.chrome-driver/profile
```

That lets cookies, site sessions, and the on-device model state persist across runs. You can provide another dedicated directory with `--profile`.

Avoid pointing Chrome Driver at a profile currently open in another Chrome process; Chromium-based browsers do not allow two live processes to own the same user-data directory.

## Current limitations

This is an MVP agent runtime, not a replacement for Playwright's full locator/accessibility stack.

- Observation is DOM-first and viewport-bounded; canvas-heavy apps may need a vision adapter.
- Cross-origin iframe content is not yet traversed by the observer.
- Closed shadow roots are not observable.
- CAPTCHAs, 2FA, missing credentials, and ambiguous human decisions should produce `handoff`.
- Built-in AI availability is still controlled by Chrome version, device capability, profile state, and enterprise policy.
- Headed Chrome is the recommended first target; validate headless behavior on the machines you intend to run.

## Next useful extensions

- optional image/screenshot observations using the Prompt API's image modality
- iframe and open-shadow-root traversal
- site policy files (`allow`, `deny`, confirmation rules)
- reusable task macros and deterministic assertions
- trace recording with DOM snapshot/action/result provenance
- WebMCP tool discovery for sites that expose structured agent actions

## Development

```powershell
npm run typecheck
npm run build
```

The codebase is intentionally small so the control boundary between inference and browser execution remains inspectable.
