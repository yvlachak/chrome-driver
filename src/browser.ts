import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import {
  chromeLaunchArgs,
  hostDiagnostics,
  type BootstrapInfo,
  type CompatibilityMode,
} from './bootstrap.js';
import { startInferenceHost, type InferenceHost } from './inference-host.js';
import type { NanoStatus } from './types.js';

export interface BrowserOptions {
  userDataDir?: string;
  headless?: boolean;
  port?: number;
  compatibilityMode?: CompatibilityMode;
}

export interface ChromeDriverBrowser {
  context: BrowserContext;
  inferencePage: Page;
  targetPage: Page;
  host: InferenceHost;
  bootstrap: BootstrapInfo;
  status(): Promise<NanoStatus>;
  initializeNano(): Promise<NanoStatus>;
  promptNano(message: string): Promise<unknown>;
  close(): Promise<void>;
}

interface ActiveChrome {
  context: BrowserContext;
  inferencePage: Page;
}

async function readStatus(page: Page): Promise<NanoStatus> {
  return page.evaluate(async () => {
    const api = (globalThis as any).chromeDriverNano;
    return api.status();
  }) as Promise<NanoStatus>;
}

async function waitForAvailability(page: Page, timeoutMs: number): Promise<NanoStatus> {
  const deadline = Date.now() + timeoutMs;
  let current = await readStatus(page);

  while (
    current.supported &&
    current.availability === 'unavailable' &&
    Date.now() < deadline
  ) {
    await page.waitForTimeout(500);
    current = await readStatus(page);
  }

  return current;
}

async function launchChrome(
  userDataDir: string,
  host: InferenceHost,
  headless: boolean,
  useCompatibilityOverride: boolean,
): Promise<ActiveChrome> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless,
    viewport: { width: 1440, height: 900 },
    args: chromeLaunchArgs(useCompatibilityOverride),
  });

  try {
    const inferencePage = context.pages()[0] ?? (await context.newPage());
    await inferencePage.goto(host.url, { waitUntil: 'domcontentloaded' });
    return { context, inferencePage };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}

export async function openChromeDriverBrowser(options: BrowserOptions = {}): Promise<ChromeDriverBrowser> {
  const userDataDir = path.resolve(options.userDataDir ?? '.chrome-driver/profile');
  const compatibilityMode = options.compatibilityMode ?? 'auto';
  const headless = options.headless ?? false;
  await mkdir(userDataDir, { recursive: true });

  const host = await startInferenceHost(options.port ?? 0);
  let active: ActiveChrome | undefined;

  try {
    const forceCompatibility = compatibilityMode === 'force';
    active = await launchChrome(userDataDir, host, headless, forceCompatibility);

    let activeMode: 'native' | 'compat' = forceCompatibility ? 'compat' : 'native';
    let initial = await waitForAvailability(active.inferencePage, forceCompatibility ? 15_000 : 5_000);
    const nativeAvailability = forceCompatibility ? 'skipped' : initial.availability;

    if (
      compatibilityMode === 'auto' &&
      initial.supported &&
      initial.availability === 'unavailable'
    ) {
      await active.context.close();
      active = await launchChrome(userDataDir, host, headless, true);
      activeMode = 'compat';
      initial = await waitForAvailability(active.inferencePage, 30_000);
    }

    const inferencePage = active.inferencePage;
    const context = active.context;
    const targetPage = await context.newPage();

    const bootstrap: BootstrapInfo = {
      requestedMode: compatibilityMode,
      activeMode,
      nativeAvailability,
      finalAvailability: initial.availability,
      host: hostDiagnostics(),
    };

    const status = async () => readStatus(inferencePage);

    const initializeNano = async () => {
      const before = await waitForAvailability(inferencePage, activeMode === 'compat' ? 30_000 : 5_000);
      if (!before.supported) {
        throw new Error(
          'Chrome did not expose the Prompt API (LanguageModel). Update Google Chrome and verify built-in AI is enabled for this installation.',
        );
      }
      if (before.availability === 'unavailable') {
        const memory = bootstrap.host.totalMemoryGiB.toFixed(1);
        const modeHint =
          compatibilityMode === 'native'
            ? ' Retry without --compat-mode native to allow the automatic compatibility fallback.'
            : ' Chrome still rejected the model after the automatic performance-class compatibility fallback.';
        throw new Error(
          `Chrome reports the built-in language model as unavailable (${memory} GiB RAM, ${bootstrap.host.logicalCpuCount} logical CPUs, mode=${activeMode}).${modeHint}`,
        );
      }

      await inferencePage.locator('#initialize').click();
      await inferencePage.waitForFunction(
        () => {
          const runtime = (globalThis as any).chromeDriverNano?.runtime?.();
          return runtime?.state === 'ready' || runtime?.state === 'error';
        },
        undefined,
        { timeout: 20 * 60 * 1000 },
      );

      const after = await status();
      if (after.state !== 'ready') {
        throw new Error(after.error || `Gemini Nano initialization ended in state: ${after.state}`);
      }
      return after;
    };

    const promptNano = (message: string) =>
      inferencePage.evaluate(async (input) => {
        const api = (globalThis as any).chromeDriverNano;
        return api.prompt(input);
      }, message);

    return {
      context,
      inferencePage,
      targetPage,
      host,
      bootstrap,
      status,
      initializeNano,
      promptNano,
      close: async () => {
        await context.close();
        await host.close();
      },
    };
  } catch (error) {
    await active?.context.close().catch(() => undefined);
    await host.close().catch(() => undefined);
    throw error;
  }
}
