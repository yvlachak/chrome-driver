import http from 'node:http';

export interface InferenceHost {
  url: string;
  close(): Promise<void>;
}

const SYSTEM_PROMPT = `You are Chrome Driver, a browser automation planner running locally in Chrome.
Choose exactly one browser action per turn. You do not execute JavaScript and you never invent element references.
Use only element refs present in the current observation. Prefer direct, minimal actions.
Action semantics:
- navigate: set url to an explicit http/https URL.
- click: set target to an observed element ref.
- fill: set target and value.
- press: set key; target is optional.
- select: set target and option.
- scroll: set value to up, down, top, or bottom.
- wait: set value to milliseconds, normally 500-3000.
- back: go to the previous page.
- finish: only when the goal is demonstrably complete; put the result in answer.
- handoff: when the task requires CAPTCHA, 2FA, credentials you do not have, or human judgment.
For unused string fields return an empty string. Never claim success merely because an action was attempted.`;

const ACTION_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['navigate', 'click', 'fill', 'press', 'select', 'scroll', 'wait', 'back', 'finish', 'handoff'],
    },
    target: { type: 'string' },
    value: { type: 'string' },
    url: { type: 'string' },
    key: { type: 'string' },
    option: { type: 'string' },
    reason: { type: 'string' },
    answer: { type: 'string' },
  },
  required: ['action', 'target', 'value', 'url', 'key', 'option', 'reason', 'answer'],
  additionalProperties: false,
};

function html() {
  const systemPrompt = JSON.stringify(SYSTEM_PROMPT);
  const actionSchema = JSON.stringify(ACTION_SCHEMA);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chrome Driver · Gemini Nano Host</title>
  <style>
    body { font: 15px system-ui, sans-serif; max-width: 760px; margin: 48px auto; padding: 0 20px; line-height: 1.5; }
    button { font: inherit; padding: 10px 14px; cursor: pointer; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    #state { margin-top: 18px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>Chrome Driver inference host</h1>
  <p>This page owns the Chrome built-in <code>LanguageModel</code> session. Inference stays inside Chrome.</p>
  <button id="initialize">Initialize Gemini Nano</button>
  <pre id="state">idle</pre>
<script>
(() => {
  const createOptions = {
    initialPrompts: [{ role: 'system', content: ${systemPrompt} }],
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  };
  const actionSchema = ${actionSchema};
  let session = null;
  let runtimeState = 'idle';
  let progress = 0;
  let lastError = '';

  const stateEl = document.getElementById('state');
  const render = (message = '') => {
    stateEl.textContent = JSON.stringify({ runtimeState, progress, lastError, message }, null, 2);
  };

  async function status() {
    const supported = typeof globalThis.LanguageModel !== 'undefined';
    let availability = 'unsupported';
    if (supported) {
      try {
        availability = await LanguageModel.availability(createOptions);
      } catch (error) {
        availability = 'error';
        lastError = String(error?.message || error);
      }
    }
    return { supported, availability, state: runtimeState, progress, error: lastError };
  }

  async function initialize() {
    if (session) return status();
    if (typeof globalThis.LanguageModel === 'undefined') {
      runtimeState = 'error';
      lastError = 'LanguageModel is not exposed by this Chrome build/profile.';
      render();
      throw new Error(lastError);
    }

    runtimeState = 'initializing';
    lastError = '';
    render('Chrome may download the on-device model on first use.');

    try {
      session = await LanguageModel.create({
        ...createOptions,
        monitor(monitor) {
          monitor.addEventListener('downloadprogress', (event) => {
            progress = Math.round(Number(event.loaded || 0) * 100);
            render('Downloading model');
          });
        },
      });
      runtimeState = 'ready';
      progress = 100;
      render('Ready');
      return status();
    } catch (error) {
      runtimeState = 'error';
      lastError = String(error?.message || error);
      render();
      throw error;
    }
  }

  async function prompt(message) {
    if (!session) throw new Error('Gemini Nano session is not initialized.');
    const response = await session.prompt(message, {
      responseConstraint: actionSchema,
      omitResponseConstraintInput: true,
    });
    return JSON.parse(response);
  }

  window.chromeDriverNano = {
    status,
    initialize,
    prompt,
    runtime: () => ({ state: runtimeState, progress, error: lastError }),
  };

  document.getElementById('initialize').addEventListener('click', async () => {
    try { await initialize(); } catch (_) { /* state is rendered above */ }
  });
  render();
})();
</script>
</body>
</html>`;
}

export async function startInferenceHost(port = 0): Promise<InferenceHost> {
  const server = http.createServer((request, response) => {
    if (request.url === '/' || request.url === '/index.html') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(html());
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to determine inference host port.');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
