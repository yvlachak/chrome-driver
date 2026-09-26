import type { Page } from 'playwright';
import { assessRisk } from './risk.js';
import { locatorForRef, observePage } from './observe.js';
import { ACTION_NAMES, type AgentAction, type AgentResult, type PageObservation, type StepRecord } from './types.js';

export interface AgentOptions {
  goal: string;
  maxSteps?: number;
  approveRisk?: (reason: string, action: AgentAction) => Promise<boolean>;
  onStep?: (record: StepRecord) => void;
}

export interface NanoPrompter {
  promptNano(message: string): Promise<unknown>;
}

function normalizeAction(raw: unknown): AgentAction {
  if (!raw || typeof raw !== 'object') throw new Error('Gemini Nano returned a non-object action.');
  const input = raw as Record<string, unknown>;
  if (typeof input.action !== 'string' || !ACTION_NAMES.includes(input.action as AgentAction['action'])) {
    throw new Error(`Gemini Nano returned an unsupported action: ${String(input.action)}`);
  }

  const field = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '');
  return {
    action: input.action as AgentAction['action'],
    target: field('target'),
    value: field('value'),
    url: field('url'),
    key: field('key'),
    option: field('option'),
    reason: field('reason'),
    answer: field('answer'),
  };
}

function buildPrompt(goal: string, observation: PageObservation, history: StepRecord[]) {
  const recent = history.slice(-6).map((item) => ({
    step: item.step,
    action: item.action,
    result: item.result,
    url: item.url,
  }));

  return [
    `GOAL:\n${goal}`,
    `CURRENT PAGE OBSERVATION:\n${JSON.stringify(observation)}`,
    `RECENT ACTION HISTORY:\n${JSON.stringify(recent)}`,
    'Choose the single best next action. Use finish only if the observation proves the goal is complete.',
  ].join('\n\n');
}

async function executeAction(page: Page, action: AgentAction): Promise<string> {
  switch (action.action) {
    case 'navigate': {
      if (!action.url) return 'failed: navigate requires url';
      const url = new URL(action.url);
      if (!['http:', 'https:'].includes(url.protocol)) return `failed: unsupported protocol ${url.protocol}`;
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return `navigated to ${page.url()}`;
    }
    case 'click': {
      if (!action.target) return 'failed: click requires target';
      const locator = locatorForRef(page, action.target);
      if ((await locator.count()) === 0) return `failed: stale or missing ref ${action.target}`;
      await locator.click({ timeout: 10_000 });
      return `clicked ${action.target}`;
    }
    case 'fill': {
      if (!action.target) return 'failed: fill requires target';
      const locator = locatorForRef(page, action.target);
      if ((await locator.count()) === 0) return `failed: stale or missing ref ${action.target}`;
      await locator.fill(action.value, { timeout: 10_000 });
      return `filled ${action.target}`;
    }
    case 'press': {
      const key = action.key || 'Enter';
      if (action.target) {
        const locator = locatorForRef(page, action.target);
        if ((await locator.count()) === 0) return `failed: stale or missing ref ${action.target}`;
        await locator.press(key, { timeout: 10_000 });
      } else {
        await page.keyboard.press(key);
      }
      return `pressed ${key}${action.target ? ` on ${action.target}` : ''}`;
    }
    case 'select': {
      if (!action.target) return 'failed: select requires target';
      const locator = locatorForRef(page, action.target);
      if ((await locator.count()) === 0) return `failed: stale or missing ref ${action.target}`;
      await locator.selectOption({ label: action.option || action.value }, { timeout: 10_000 });
      return `selected ${action.option || action.value} on ${action.target}`;
    }
    case 'scroll': {
      const direction = action.value.toLowerCase();
      if (direction === 'top') await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      else if (direction === 'bottom') await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      else {
        const amount = await page.evaluate(() => Math.max(400, Math.round(window.innerHeight * 0.75)));
        await page.mouse.wheel(0, direction === 'up' ? -amount : amount);
      }
      await page.waitForTimeout(250);
      return `scrolled ${direction || 'down'}`;
    }
    case 'wait': {
      const requested = Number.parseInt(action.value || '1000', 10);
      const ms = Math.min(5000, Math.max(200, Number.isFinite(requested) ? requested : 1000));
      await page.waitForTimeout(ms);
      return `waited ${ms}ms`;
    }
    case 'back': {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null);
      return `went back to ${page.url()}`;
    }
    case 'finish':
      return 'finished';
    case 'handoff':
      return 'human handoff requested';
  }
}

export class ChromeDriverAgent {
  constructor(
    private readonly page: Page,
    private readonly nano: NanoPrompter,
    private readonly options: AgentOptions,
  ) {}

  async run(): Promise<AgentResult> {
    const history: StepRecord[] = [];
    const maxSteps = this.options.maxSteps ?? 25;
    let repeatedSignature = '';
    let repeatCount = 0;

    for (let step = 1; step <= maxSteps; step += 1) {
      const observation = await observePage(this.page);
      const raw = await this.nano.promptNano(buildPrompt(this.options.goal, observation, history));
      const action = normalizeAction(raw);

      if (action.action === 'finish') {
        return { status: 'completed', answer: action.answer || action.reason || 'Goal completed.', steps: history };
      }
      if (action.action === 'handoff') {
        return { status: 'needs-human', answer: action.reason || 'Gemini Nano requested human intervention.', steps: history };
      }

      const risk = assessRisk(action, observation);
      if (risk) {
        const approved = (await this.options.approveRisk?.(risk, action)) ?? false;
        if (!approved) {
          return { status: 'blocked', answer: `Stopped before ${risk}.`, steps: history };
        }
      }

      let result: string;
      try {
        result = await executeAction(this.page, action);
        await this.page.waitForLoadState('domcontentloaded', { timeout: 2500 }).catch(() => undefined);
      } catch (error) {
        result = `failed: ${error instanceof Error ? error.message : String(error)}`;
      }

      const record: StepRecord = { step, action, result, url: this.page.url() };
      history.push(record);
      this.options.onStep?.(record);

      const signature = JSON.stringify({ action, result, url: this.page.url() });
      if (signature === repeatedSignature) repeatCount += 1;
      else {
        repeatedSignature = signature;
        repeatCount = 1;
      }
      if (repeatCount >= 3) {
        return {
          status: 'stalled',
          answer: 'Stopped after the same action/result repeated three times.',
          steps: history,
        };
      }
    }

    return {
      status: 'max-steps',
      answer: `Stopped after reaching the ${maxSteps}-step limit.`,
      steps: history,
    };
  }
}
