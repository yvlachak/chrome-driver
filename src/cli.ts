#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ChromeDriverAgent } from './agent.js';
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
  chrome-driver doctor [--profile PATH] [--headless]
  chrome-driver run --goal "..." [--start URL] [--profile PATH] [--max-steps 25] [--yes] [--headless]

Options:
  --goal TEXT       Natural-language automation goal
  --start URL       Starting URL for the target tab
  --profile PATH    Persistent Chrome profile directory (default: .chrome-driver/profile)
  --max-steps N     Agent step limit (default: 25)
  --yes             Auto-approve deterministic high-impact click guard
  --headless        Run branded Chrome headless (headed mode is recommended initially)
  --port N          Fixed localhost inference-host port (default: random)
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
  });
}

async function doctor() {
  console.log('Launching installed Google Chrome and checking the built-in Prompt API...');
  console.log('On first use, Chrome may download Gemini Nano. Chrome documents an unmetered connection and sufficient free disk space as requirements.');
  const browser = await open();
  try {
    console.log('Before initialization:', await browser.status());
    console.log('Initializing through a real browser click so Chrome can satisfy user-activation requirements...');
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
  const browser = await open();
  try {
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
      approveRisk: autoApprove ? async () => true : confirmRisk,
      onStep: (record) => {
        console.log(`\n[${record.step}] ${record.action.action} ${record.action.target || record.action.url || record.action.value}`.trim());
        console.log(`    ${record.result}`);
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
