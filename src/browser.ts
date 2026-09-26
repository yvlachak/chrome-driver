import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { startInferenceHost, type InferenceHost } from './inference-host.js';
import type { NanoStatus } from './types.js';

export interface BrowserOptions {
  userDataDir?: string;
  headless?: boolean;
  port?: number;
}

export interface ChromeDriverBrowser {
  context: BrowserContext;
  inferencePage: Page;
  targetPage: Page;
  host: InferenceHost;
  status(): Promise<NanoStatus>;
  initializeNano(): Promise<NanoStatus>;
  promptNano(message: string): Promise<unknown>;
  close(): Promise<void>;
}

export async function openChromeDriverBrowser(options: BrowserOptions = {}): Promise<ChromeDriverBrowser> {
  const userDataDir = path.resolve(options.userDataDir ?? '.chrome-driver/profile');
  await mkdir(userDataDir, { recursive: true });

  const host = await startInferenceHost(options.port ?? 0);
  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chrome',
      headless: options.headless ?? false,
      viewport: { width: 1440, height: 900 },
    });

    const inferencePage = context.pages()[0] ?? (await context.newPage());
    await inferencePage.goto(host.url, { waitUntil: 'domcontentloaded' });

    const status = async () =>
      inferencePage.evaluate(async () => {
        const api = (globalThis as any).chromeDriverNano;
        return api.status();
      }) as Promise<NanoStatus>;

    const initializeNano = async () => {
      const before = await status();
      if (!before.supported) {
        throw new Error(
          'Chrome did not expose the Prompt API (LanguageModel). Check Chrome version, device requirements, policy, and built-in AI availability.',
        );
      }
      if (before.availability === 'unavailable') {
        throw new Error('Chrome reports the built-in language model as unavailable on this device/profile.');
      }

      await inferencePage.locator('#initialize').click();
      await inferencePage.waitForFunction(
        () => {
          const runtime = (globalThis as any).chromeDriverNano?.runtime?.();
          return runtime?.state === 'ready' || runtime?.state === 'error';
        },
        undefined,
        { timeout: 10 * 60 * 1000 },
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

    const targetPage = await context.newPage();

    return {
      context,
      inferencePage,
      targetPage,
      host,
      status,
      initializeNano,
      promptNano,
      close: async () => {
        await context?.close();
        await host.close();
      },
    };
  } catch (error) {
    await context?.close().catch(() => undefined);
    await host.close().catch(() => undefined);
    throw error;
  }
}
