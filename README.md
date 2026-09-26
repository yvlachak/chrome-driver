# chrome-driver

A local-first Playwright browser agent whose planner is **Gemini Nano running natively inside Google Chrome** through Chrome's built-in Prompt API.

The design keeps the model inside Chrome and Playwright in Node.js. There is no OpenAI/Anthropic/Gemini cloud API, no model API key, and model output is never executed as arbitrary JavaScript.

## How it works

1. Chrome Driver launches installed **Google Chrome** using Playwright's `channel: "chrome"` with a persistent, dedicated profile.
2. Startup suppresses Chrome first-run/default-browser/search-choice UI that would otherwise interfere with automation.
3. Chrome Driver probes `LanguageModel.availability()` using Chrome itself as the source of truth.
4. In the default `auto` mode, native eligibility is tried first. If Chrome reports the local model as `unavailable`, Chrome Driver transparently relaunches the same dedicated profile with Chromium's on-device performance-class compatibility parameters. This changes performance eligibility only; it does **not** disable Chrome's text-safety classifier.
5. A localhost top-level page initializes Chrome's built-in `LanguageModel` / Gemini Nano session. On first use, Chrome can download the model through the normal component/model path.
6. A separate target tab is observed through Playwright.
7. Gemini Nano receives bounded page state and returns exactly one JSON-schema-constrained action.
8. A deterministic executor maps that action to Playwright and repeats until the goal is complete, blocked, or the step budget is exhausted.

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

You need Node.js 20+ and an installed desktop Google Chrome build that exposes the Prompt API.

Chrome's documented native foundation-model eligibility includes supported desktop operating systems, sufficient disk space, and supported CPU/GPU hardware. **Chrome Driver no longer requires you to manually edit `chrome://flags` on borderline development machines.** Its default `auto` compatibility mode first preserves Chrome's normal native eligibility path, then falls back to Chromium's performance-class override only when Chrome itself reports the model as unavailable.

The compatibility fallback uses the same `OnDeviceModelPerformanceParams` parameters Chromium exposes for its BypassPerfRequirement / Force Small Model development variations. It intentionally does not bypass text safety.

Reference: https://developer.chrome.com/docs/ai/prompt-api

## Install

```powershell
git clone https://github.com/yvlachak/chrome-driver.git
cd chrome-driver
npm install
npm run build
```

This project intentionally uses installed branded Chrome rather than Playwright's bundled Chromium because the built-in Gemini Nano API belongs to Chrome.

## Zero-touch first run

Run:

```powershell
npm run doctor
```

`doctor` now performs the setup path itself:

- creates/reuses `.chrome-driver/profile`
- suppresses first-run/profile onboarding UI used by a fresh automation profile
- checks the Prompt API
- tries Chrome's native model eligibility first
- automatically relaunches with the performance-class compatibility path if native availability is `unavailable`
- performs the real browser click required for model initialization
- waits for the initial model download/initialization when necessary
- reports the active bootstrap mode and basic host diagnostics

A healthy first run should end with:

```text
Doctor passed: Gemini Nano is ready for local inference.
```

No manual `chrome://flags`, `chrome://on-device-internals`, profile selection, or Chrome sign-in should normally be required.

## Run an agent

PowerShell:

```powershell
npm run dev -- run `
  --start https://example.com `
  --goal "Open the More information link and tell me the title of the destination page."
```

CMD:

```cmd
npm run dev -- run --start https://example.com --goal "Open the More information link and tell me the title of the destination page."
```

Or after `npm run build`:

```powershell
node dist/cli.js run --start https://example.com --goal "Open the More information link and tell me the final page title."
```

Useful flags:

```text
--profile PATH          persistent Chrome profile directory
--max-steps N           maximum model/action turns (default 25)
--yes                   auto-approve the narrow high-impact click guard
--compat-mode auto      native first, then automatic compatibility fallback (default)
--compat-mode native    never override Chrome's hardware/performance eligibility
--compat-mode force     always use the Chromium performance compatibility parameters
--headless              use Chrome headless; headed mode is recommended for initial validation
--port N                pin the localhost inference-host port
```

## Compatibility modes

`auto` is the recommended/default mode. It does not guess based on a hard-coded RAM threshold. Instead, Chrome decides whether the model is natively available. Only an explicit `unavailable` result triggers the compatibility relaunch.

`native` is useful when validating production hardware against Chrome's official eligibility without any performance override.

`force` is useful for development machines known to sit below Chrome's normal performance class. It enables these Chromium feature parameters at launch:

```text
OnDeviceModelPerformanceParams:
  compatible_on_device_performance_classes/*
  compatible_low_tier_on_device_performance_classes/*
```

Chrome Driver also requests a performance-class refresh at startup. Safety-model behavior is left unchanged.

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

The compatibility bootstrap does not disable Chrome's text-safety classifier.

For trusted unattended workflows, `--yes` bypasses the browser-action confirmation prompt. Site-specific allowlists and stronger transaction policies should be added before production use.

## Profiles and authenticated sites

The default profile is dedicated to Chrome Driver:

```text
.chrome-driver/profile
```

That lets cookies, site sessions, component/model state, and the on-device model state persist across runs. You can provide another dedicated directory with `--profile`.

Avoid pointing Chrome Driver at a profile currently open in another Chrome process; Chromium-based browsers do not allow two live processes to own the same user-data directory.

## Current limitations

This is an MVP agent runtime, not a replacement for Playwright's full locator/accessibility stack.

- The compatibility override can permit Chrome to attempt inference on hardware below its normal performance class; such machines can be slower or may fail from resource pressure. Use `--compat-mode native` when strict native eligibility matters.
- Observation is DOM-first and viewport-bounded; canvas-heavy apps may need a vision adapter.
- Cross-origin iframe content is not yet traversed by the observer.
- Closed shadow roots are not observable.
- CAPTCHAs, 2FA, missing credentials, and ambiguous human decisions should produce `handoff`.
- Enterprise policy can still prohibit the built-in model/API; Chrome Driver does not attempt to bypass administrative policy.
- Headed Chrome is the recommended first target; validate headless behavior on the machines you intend to run.

## Next useful extensions

- richer component/model bootstrap diagnostics when Chrome remains unavailable after compatibility fallback
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
