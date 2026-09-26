#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ChromeDriverAgent } from './agent.js';
import { parseCompatibilityMode } from './bootstrap.js';
import { openChromeDriverBrowser } from './browser.js';
import type { AgentAction } from './types.js';

function valueOf(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function has(name: string) {
  return process.argv.includes(name);
}

function usage() {
  console.log(`chrome-driver

Usage:
  chrome-driver doctor [--profile PATH] [--compat-mode auto|native|force] [--headless]
  chrome-driver run --goal "..." [--start URL] [--profile PATH] [--max-steps 25] [--memory-budget 11000] [--yes] [--compat-mode auto|native|force] [--headless]

Options:
  --goal TEXT         Natural-language automation goal
  --start URL         Starting URL for the target tab
  --profile PATH      Persistent Chrome profile directory (default: .chrome-driver/profile)
  --max-steps N       Agent step limit (default: 25)
  --memory-budget N   Approximate harness-memory character budget sent per decision (default: 11000)
  --yes               Auto-approve deterministic high-impact action guard
  --compat-mode M     Built-in AI eligibility mode: auto (default), native, or force
  --headless          Run branded Chrome headless (headed mode is recommended initially)
  --port N            Fixed localhost inference-host port (default: random)
`);
}

async function confirmRisk(reason: string, action: AgentAction) {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`\nApproval required: ${reason}\nAction: ${JSON.stringify(action)}\nProceed? [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function open() {
  const portValue = valueOf('--port');
  return openChromeDriverBrowser({
    userDataDir: valueOf('--profile'),
    headless: has('--headless'),
    port: portValue ? Number.parseInt(portValue, 10) : 0,
    compatibilityMode: parseCompatibilityMode(valueOf('--compat-mode')),
  });
}

function printBootstrap(browser: Awaited<ReturnType<typeof open>>) {
  const info = browser.bootstrap;
  console.log(
    `Chrome bootstrap: mode=${info.activeMode}, native=${info.nativeAvailability}, final=${info.finalAvailability}, RAM=${info.host.totalMemoryGiB} GiB, CPUs=${info.host.logicalCpuCount}`,
  );
  if (info.activeMode === 'compat' && info.requestedMode === 'auto') {
    console.log(
      'Native eligibility was unavailable, so chrome-driver automatically relaunched Chrome with Chromium performance-class compatibility parameters. Text-safety remains enabled.',
    );
  }
}

async function doctor() {
  console.log('Launching installed Google Chrome and bootstrapping the built-in Prompt API...');
  console.log('First-run/profile UI is suppressed for the dedicated automation profile. If needed, chrome-driver automatically applies the on-device performance compatibility path.');
  const browser = await open();
  try {
    printBootstrap(browser);
    console.log('Before initialization:', await browser.status());
    console.log('Initializing Gemini Nano. Chrome may download the model on first use...');
    console.log('After initialization:', await browser.initializeNano());
    console.log('Doctor passed: Gemini Nano is ready for local inference.');
  } finally {
    await browser.close();
  }
}

async function run() {
  const goal = valueOf('--goal');
  if (!goal) throw new Error('run requires --goal "..."');

  const maxSteps = Number.parseInt(valueOf('--max-steps') ?? '25', 10);
  const memoryBudget = Number.parseInt(valueOf('--memory-budget') ?? '11000', 10);
  const browser = await open();
  try {
    printBootstrap(browser);
    console.log('Initializing Chrome built-in Gemini Nano...');
    const nano = await browser.initializeNano();
    console.log(`Gemini Nano ready (${nano.availability}).`);

    const start = valueOf('--start');
    if (start) {
      await browser.targetPage.goto(start, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }

    const autoApprove = has('--yes');
    const agent = new ChromeDriverAgent(browser.targetPage, browser, {
      goal,
      maxSteps: Number.isFinite(maxSteps) ? maxSteps : 25,
      protectedPages: [browser.inferencePage],
      memory: {
        contextBudget: Number.isFinite(memoryBudget) ? Math.max(3000, memoryBudget) : 11_000,
      },
      approveRisk: autoApprove ? async () => true : confirmRisk,
      onStep: (record) => {
        const argument = record.action.target || record.action.url || record.action.tab || record.action.value;
        console.log(`\n[${record.step}] ${record.action.action} ${argument}`.trim());
        console.log(`    ${record.result.length > 1200 ? `${record.result.slice(0, 1200)}…` : record.result}`);
      },
    });

    const result = await agent.run();
    console.log(`\nStatus: ${result.status}`);
    console.log(result.answer);
    if (result.status !== 'completed') process.exitCode = 2;
  } finally {
    await browser.close();
  }
}

async function main() {
  const command = process.argv[2];
  if (!command || has('--help') || has('-h')) {
    usage();
    return;
  }
  if (command === 'doctor') return doctor();
  if (command === 'run') return run();
  usage();
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`chrome-driver: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
