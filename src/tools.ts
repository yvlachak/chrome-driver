import type { Page } from 'playwright';
import { locatorForRef } from './observe.js';
import { ACTION_GUIDE, type ActionName, type AgentAction, type ToolExecutionResult } from './types.js';

export interface ToolRuntime {
  activePage(): Page;
  setActivePage(page: Page): void;
  userPages(): Page[];
  remember(text: string): string | null;
  forget(query: string): number;
}

export interface ToolDefinition {
  name: ActionName;
  execute(runtime: ToolRuntime, action: AgentAction): Promise<ToolExecutionResult>;
}

const clip = (value: string, max = 5000) => value.replace(/\s+/g, ' ').trim().slice(0, max);

function ok(message: string, data?: string, remember?: string[]): ToolExecutionResult {
  return { ok: true, message, data, remember };
}

function fail(message: string): ToolExecutionResult {
  return { ok: false, message: `failed: ${message}` };
}

function parseHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

async function target(runtime: ToolRuntime, ref: string) {
  if (!ref) return null;
  const locator = locatorForRef(runtime.activePage(), ref);
  if ((await locator.count()) === 0) return null;
  return locator;
}

const definitions: ToolDefinition[] = [
  {
    name: 'navigate',
    async execute(runtime, action) {
      if (!action.url) return fail('navigate requires url');
      const url = parseHttpUrl(action.url);
      if (!url) return fail('navigate requires a valid http/https URL');
      await runtime.activePage().goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return ok(`navigated to ${runtime.activePage().url()}`);
    },
  },
  {
    name: 'click',
    async execute(runtime, action) {
      const locator = await target(runtime, action.target);
      if (!locator) return fail(`stale or missing ref ${action.target || '(empty)'}`);
      await locator.click({ timeout: 10_000 });
      return ok(`clicked ${action.target}`);
    },
  },
  {
    name: 'fill',
    async execute(runtime, action) {
      const locator = await target(runtime, action.target);
      if (!locator) return fail(`stale or missing ref ${action.target || '(empty)'}`);
      await locator.fill(action.value, { timeout: 10_000 });
      return ok(`filled ${action.target}`);
    },
  },
  {
    name: 'clear',
    async execute(runtime, action) {
      const locator = await target(runtime, action.target);
      if (!locator) return fail(`stale or missing ref ${action.target || '(empty)'}`);
      await locator.clear({ timeout: 10_000 });
      return ok(`cleared ${action.target}`);
    },
  },
  {
    name: 'press',
    async execute(runtime, action) {
      const key = action.key || 'Enter';
      if (action.target) {
        const locator = await target(runtime, action.target);
        if (!locator) return fail(`stale or missing ref ${action.target}`);
        await locator.press(key, { timeout: 10_000 });
      } else {
        await runtime.activePage().keyboard.press(key);
      }
      return ok(`pressed ${key}${action.target ? ` on ${action.target}` : ''}`);
    },
  },
  {
    name: 'select',
    async execute(runtime, action) {
      const locator = await target(runtime, action.target);
      if (!locator) return fail(`stale or missing ref ${action.target || '(empty)'}`);
      const option = action.option || action.value;
      if (!option) return fail('select requires option or value');
      await locator.selectOption({ label: option }, { timeout: 10_000 });
      return ok(`selected ${option} on ${action.target}`);
    },
  },
  {
    name: 'hover',
    async execute(runtime, action) {
      const locator = await target(runtime, action.target);
      if (!locator) return fail(`stale or missing ref ${action.target || '(empty)'}`);
      await locator.hover({ timeout: 10_000 });
      return ok(`hovered ${action.target}`);
    },
  },
  {
    name: 'check',
    async execute(runtime, action) {
      const locator = await target(runtime, action.target);
      if (!locator) return fail(`stale or missing ref ${action.target || '(empty)'}`);
      await locator.check({ timeout: 10_000 });
      return ok(`checked ${action.target}`);
    },
  },
  {
    name: 'uncheck',
    async execute(runtime, action) {
      const locator = await target(runtime, action.target);
      if (!locator) return fail(`stale or missing ref ${action.target || '(empty)'}`);
      await locator.uncheck({ timeout: 10_000 });
      return ok(`unchecked ${action.target}`);
    },
  },
  {
    name: 'scroll',
    async execute(runtime, action) {
      const page = runtime.activePage();
      const direction = (action.value || 'down').toLowerCase();
      if (direction === 'top') await page.evaluate(() => window.scrollTo(0, 0));
      else if (direction === 'bottom') await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      else {
        const amount = await page.evaluate(() => Math.max(400, Math.round(window.innerHeight * 0.75)));
        await page.mouse.wheel(0, direction === 'up' ? -amount : amount);
      }
      await page.waitForTimeout(250);
      return ok(`scrolled ${direction}`);
    },
  },
  {
    name: 'wait',
    async execute(runtime, action) {
      const requested = Number.parseInt(action.value || '1000', 10);
      const ms = Math.min(10_000, Math.max(200, Number.isFinite(requested) ? requested : 1000));
      await runtime.activePage().waitForTimeout(ms);
      return ok(`waited ${ms}ms`);
    },
  },
  {
    name: 'back',
    async execute(runtime) {
      await runtime.activePage().goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null);
      return ok(`went back to ${runtime.activePage().url()}`);
    },
  },
  {
    name: 'forward',
    async execute(runtime) {
      await runtime.activePage().goForward({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null);
      return ok(`went forward to ${runtime.activePage().url()}`);
    },
  },
  {
    name: 'reload',
    async execute(runtime) {
      await runtime.activePage().reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
      return ok(`reloaded ${runtime.activePage().url()}`);
    },
  },
  {
    name: 'new_tab',
    async execute(runtime, action) {
      const page = await runtime.activePage().context().newPage();
      runtime.setActivePage(page);
      if (action.url) {
        const url = parseHttpUrl(action.url);
        if (!url) return fail('new_tab url must be a valid http/https URL');
        await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      }
      return ok(`opened new tab at ${page.url()}`);
    },
  },
  {
    name: 'switch_tab',
    async execute(runtime, action) {
      const index = Number.parseInt(action.tab || action.value, 10);
      const pages = runtime.userPages();
      if (!Number.isInteger(index) || index < 0 || index >= pages.length) {
        return fail(`switch_tab requires a current user-tab index from 0 to ${Math.max(0, pages.length - 1)}`);
      }
      const page = pages[index];
      if (!page) return fail(`user tab ${index} is unavailable`);
      runtime.setActivePage(page);
      await page.bringToFront();
      return ok(`switched to tab ${index}: ${page.url()}`);
    },
  },
  {
    name: 'close_tab',
    async execute(runtime, action) {
      const pages = runtime.userPages();
      if (pages.length <= 1) return fail('refusing to close the last user tab');
      const requested = action.tab || action.value;
      const page = requested ? pages[Number.parseInt(requested, 10)] : runtime.activePage();
      if (!page || !pages.includes(page)) return fail('close_tab requires a current user-tab index');
      const index = pages.indexOf(page);
      await page.close();
      const remaining = runtime.userPages();
      const next = remaining[Math.min(index, remaining.length - 1)] ?? remaining[0];
      if (next) {
        runtime.setActivePage(next);
        await next.bringToFront();
      }
      return ok(`closed tab ${index}`);
    },
  },
  {
    name: 'find_text',
    async execute(runtime, action) {
      const query = clip(action.value, 300);
      if (!query) return fail('find_text requires value');
      const locator = runtime.activePage().getByText(query, { exact: false }).first();
      if ((await locator.count()) === 0) return fail(`text not found: ${query}`);
      await locator.scrollIntoViewIfNeeded({ timeout: 10_000 });
      return ok(`found and revealed text: ${query}`);
    },
  },
  {
    name: 'extract_text',
    async execute(runtime, action) {
      let text: string;
      if (action.target) {
        const locator = await target(runtime, action.target);
        if (!locator) return fail(`stale or missing ref ${action.target}`);
        text = await locator.innerText({ timeout: 10_000 }).catch(async () => locator.textContent({ timeout: 10_000 }).then((value) => value ?? ''));
      } else {
        text = await runtime.activePage().locator('body').innerText({ timeout: 10_000 });
      }
      const data = clip(text, 5000);
      return ok(`extracted ${data.length} characters${action.target ? ` from ${action.target}` : ' from page'}`, data);
    },
  },
  {
    name: 'extract_table',
    async execute(runtime, action) {
      const locator = await target(runtime, action.target);
      if (!locator) return fail(`extract_table requires an observed table/grid ref; missing ${action.target || '(empty)'}`);
      const data = await locator.evaluate((element) => {
        const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
        const rows = Array.from(element.querySelectorAll('tr')).slice(0, 60);
        if (rows.length === 0) return clean((element as HTMLElement).innerText || element.textContent).slice(0, 7000);
        return rows
          .map((row) =>
            Array.from(row.querySelectorAll('th,td'))
              .slice(0, 30)
              .map((cell) => clean((cell as HTMLElement).innerText || cell.textContent))
              .join(' | '),
          )
          .filter(Boolean)
          .join('\n')
          .slice(0, 7000);
      });
      return ok(`extracted table ${action.target}`, data);
    },
  },
  {
    name: 'remember',
    async execute(runtime, action) {
      const text = clip(action.value, 700);
      if (!text) return fail('remember requires a grounded fact in value');
      const id = runtime.remember(text);
      return id ? ok(`remembered ${id}: ${text}`) : ok(`memory already contained: ${text}`);
    },
  },
  {
    name: 'forget',
    async execute(runtime, action) {
      const query = clip(action.value, 200);
      if (!query) return fail('forget requires a memory id or text fragment in value');
      const removed = runtime.forget(query);
      return ok(`forgot ${removed} matching memory entr${removed === 1 ? 'y' : 'ies'}`);
    },
  },
];

export class ToolRegistry {
  private readonly tools = new Map<ActionName, ToolDefinition>(definitions.map((definition) => [definition.name, definition]));

  has(name: ActionName) {
    return this.tools.has(name);
  }

  async execute(runtime: ToolRuntime, action: AgentAction) {
    const tool = this.tools.get(action.action);
    if (!tool) return fail(`no executor registered for ${action.action}`);
    return tool.execute(runtime, action);
  }

  guide() {
    return [...this.tools.keys()].map((name) => `- ${name}: ${ACTION_GUIDE[name]}`).join('\n');
  }

  names() {
    return [...this.tools.keys()];
  }
}
