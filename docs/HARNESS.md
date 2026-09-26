# Chrome Driver Harness

Chrome Driver treats Gemini Nano as a bounded decision engine inside a deterministic browser runtime. The model is not expected to remember an entire session, invent browser APIs, or recover from every failure on its own.

The harness is self-contained. It does not depend on an external orchestration, memory, or agent framework.

## Design goals

1. Keep browser execution deterministic and inspectable.
2. Make useful browser capabilities first-class tools rather than generated code.
3. Keep model context bounded as sessions become longer.
4. Preserve important facts across navigation without trusting free-form model summaries.
5. Make repeated failures visible so a small model can change strategy.
6. Keep page content untrusted and separate from the user goal and harness state.

## Decision loop

```text
user goal
   |
   v
current page observation -----> harness memory
   |                              |
   +------------+-----------------+
                v
          Gemini Nano
                |
        one typed action
                |
                v
          tool registry
                |
        deterministic result
                |
                v
          memory update
                |
                +----> next turn
```

The model chooses one constrained action. A registry-owned executor performs the action through Playwright. The result is recorded before the next decision.

## First-class toolkit

The current toolkit includes:

### Navigation and page state

- `navigate`
- `back`
- `forward`
- `reload`
- `scroll`
- `wait`
- `find_text`

### Element interaction

- `click`
- `fill`
- `clear`
- `press`
- `select`
- `hover`
- `check`
- `uncheck`

### Tabs

- `new_tab`
- `switch_tab`
- `close_tab`

The local inference-host tab is protected and never appears in the user-tab list exposed to the model.

### Deterministic extraction

- `extract_text`
- `extract_table`

Extraction tools are preferred when the model needs more than the viewport-bounded observation. Their results remain high-resolution in recent memory before being compacted.

### Memory control

- `remember`
- `forget`

`remember` pins a concise fact that is expected to remain useful after navigation or history compaction. Facts are deduplicated and bounded. `forget` removes stale pinned facts by id or text fragment.

### Control actions

- `finish`
- `handoff`

These are protocol controls rather than Playwright tools.

## Memory model

The harness uses several memory strata with different lifetimes.

### 1. Current observation

The active tab contributes:

- URL and title
- bounded visible page text
- observed element refs and state
- scroll position
- user-controlled tab list

Element refs are ephemeral and rebuilt every observation.

### 2. Recent working memory

The most recent steps are kept in detail. The newest extraction results receive a larger context allowance so the model can reason over freshly extracted text or table data.

### 3. Pinned facts

The model may explicitly preserve grounded facts with `remember`. Pinned facts survive page changes and episodic compaction.

Examples:

```text
m1: Order number is 48271
m2: Carrier SCAC is ABCD
m3: Search result on tab 1 lists $1,882
```

Pinned memory is bounded and deduplicated.

### 4. Episodic history

When recent history exceeds its working-memory window, older records are deterministically compacted into canonical action/result episodes. No language model is used to summarize them.

Example:

```text
1:navigate(https://example.com)=>navigated...
2:fill(e4)=>filled e4
3:click(e7)=>clicked e7
```

This retains provenance while reducing context growth.

### 5. Failure memory

Repeated failed action signatures are counted separately. The prompt tells the planner not to repeat a known failed pattern unless page state has materially changed.

### 6. Page trail

The harness records recently visited URLs, titles, visit counts, and the last step at which each page was observed. This helps the planner avoid unnecessary navigation loops.

## Context budget

Harness memory is bounded independently of the current page observation. The default memory budget is approximately 11,000 characters and can be changed with:

```text
--memory-budget N
```

The context is prioritized in this order:

1. pinned facts
2. recent high-resolution steps
3. known failures
4. recently visited pages
5. older compacted episodes

Older context is therefore the first material to be dropped when the budget is tight.

## Why the harness does not use model-generated memory summaries

A small language model can lose details, silently change values, or turn an inference into a remembered fact. The initial harness therefore keeps memory transformations deterministic.

The model may explicitly pin a fact, but the runtime controls:

- storage
- deduplication
- retention limits
- compaction
- failure counting
- page-history tracking
- prompt budgeting

Future memory features should preserve the same separation between model decisions and runtime-owned state.

## Adding a tool

A new action should normally require three coordinated changes:

1. add its name and concise semantic contract to `ACTION_NAMES` / `ACTION_GUIDE` in `src/types.ts`;
2. register its deterministic executor in `src/tools.ts`;
3. add focused tests for protocol registration and any pure logic.

The inference-host JSON schema is generated from the shared action protocol, which prevents the model schema from drifting away from the runtime action list.

A tool should return a bounded `ToolExecutionResult` rather than exposing arbitrary Playwright access to the model.

## Safety boundaries

The harness preserves the original control boundaries:

- page/model text is data, not executable code;
- arbitrary JavaScript is not exposed as a model action;
- navigation is restricted to HTTP(S);
- high-impact element actions are checked by a deterministic confirmation guard;
- the local inference-host page is protected from tab actions;
- CAPTCHA, 2FA, unavailable credentials, and ambiguous human judgment should result in `handoff`.

## Near-term roadmap

The next high-value toolkit extensions are:

- file upload/download primitives with explicit filesystem policy
- browser dialog handling
- open-shadow-root and iframe traversal
- deterministic assertions (`assert_text`, `assert_url`, `assert_element`)
- structured form filling
- clipboard primitives
- screenshot/image observations when DOM evidence is insufficient
- locally persisted run journals and resumable sessions
- task macros composed from first-class tools

The intended progression is to move repeatable mechanics into deterministic tools and reserve Gemini Nano for choosing among well-defined operations.
