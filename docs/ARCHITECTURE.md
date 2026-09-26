# Architecture

Chrome Driver is deliberately split into two browser pages inside one persistent, branded Chrome context.

## 1. Inference host

A tiny HTTP server binds only to `127.0.0.1` and serves a top-level page. That page owns the Chrome Prompt API `LanguageModel` session. This is important because Chrome's built-in AI APIs are document APIs rather than Node.js APIs.

The page initializes Gemini Nano from a user-activation event and exposes three in-page methods to Playwright: status, initialize, and prompt. The model receives a persistent system prompt and every action response is constrained by a JSON Schema.

No API key or remote model endpoint is used.

## 2. Target page

A second tab is the page being automated. Node/Playwright extracts a compact viewport observation consisting of:

- URL and title
- bounded visible text
- visible interactive elements
- deterministic ephemeral refs such as `e1`, `e2`, ...
- scroll position

Those observations are serialized into the local Prompt API session. Gemini Nano returns one structured action.

## 3. Deterministic executor

Model output is not evaluated as JavaScript. The executor supports only a fixed action vocabulary:

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

Element actions must reference an element from the most recent observation. Refs are intentionally ephemeral so the model is forced to inspect the current page again after each action.

## 4. Guardrails

The executor rejects non-HTTP(S) navigation and has a deterministic confirmation guard around a narrow set of high-impact clicks such as purchases, fund transfers, destructive account actions, publishing, and sending email. `--yes` can disable the interactive confirmation for trusted workflows.

The loop also stops when the same action/result repeats three times or when the configured step budget is exhausted.

## Why not run the Prompt API directly in Node?

Chrome's `LanguageModel` lives in the browser execution environment. Keeping inference in a local top-level page avoids a cloud bridge and lets Playwright remain the control plane.

## Why DOM-first instead of screenshot-first?

Gemini Nano now supports multimodal Prompt API inputs, but DOM observations are cheaper, easier to constrain, and give Playwright deterministic targets. A future vision adapter can add viewport screenshots or canvas captures as optional context for sites whose semantics are not represented in the DOM.
