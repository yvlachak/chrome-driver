import type { Page } from 'playwright';
import type { PageObservation } from './types.js';

const REF_ATTRIBUTE = 'data-chrome-driver-ref';

export async function observePage(page: Page): Promise<PageObservation> {
  return page.evaluate((refAttribute) => {
    const clip = (value: string | null | undefined, max = 220) =>
      (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

    const visibleInViewport = (element: Element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
      if (rect.right < 0 || rect.left > window.innerWidth) return false;
      const style = window.getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0;
    };

    document.querySelectorAll(`[${refAttribute}]`).forEach((element) => {
      element.removeAttribute(refAttribute);
    });

    const selector = [
      'a[href]',
      'button',
      'input',
      'textarea',
      'select',
      '[contenteditable="true"]',
      '[role="button"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="combobox"]',
      '[role="menuitem"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const interactive = Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter(visibleInViewport)
      .slice(0, 100);

    const elements = interactive.map((element, index) => {
      const ref = `e${index + 1}`;
      element.setAttribute(refAttribute, ref);

      const input = element instanceof HTMLInputElement ? element : null;
      const select = element instanceof HTMLSelectElement ? element : null;
      const anchor = element instanceof HTMLAnchorElement ? element : null;
      const role = element.getAttribute('role') ?? '';
      const ariaLabel = element.getAttribute('aria-label');
      const labelledBy = element.getAttribute('aria-labelledby');
      const labelledText = labelledBy
        ? labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.innerText ?? '')
            .join(' ')
        : '';
      const name = clip(
        ariaLabel ||
          labelledText ||
          element.getAttribute('title') ||
          element.getAttribute('placeholder') ||
          element.innerText ||
          (input && input.type !== 'password' ? input.value : '') ||
          (select ? select.selectedOptions[0]?.text : '') ||
          element.getAttribute('name') ||
          element.getAttribute('id'),
      );

      return {
        ref,
        tag: element.tagName.toLowerCase(),
        role,
        inputType: input?.type ?? '',
        name,
        text: clip(element.innerText || element.textContent),
        href: clip(anchor?.href ?? element.getAttribute('href'), 320),
        disabled:
          (element instanceof HTMLButtonElement ||
            element instanceof HTMLInputElement ||
            element instanceof HTMLSelectElement ||
            element instanceof HTMLTextAreaElement) &&
          element.disabled,
      };
    });

    const seen = new Set<string>();
    const textParts: string[] = [];
    const textCandidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'h1,h2,h3,h4,p,li,label,td,th,summary,[role="heading"],[role="alert"],[role="status"]',
      ),
    );

    for (const element of textCandidates) {
      if (!visibleInViewport(element)) continue;
      const text = clip(element.innerText || element.textContent, 500);
      if (text.length < 2 || seen.has(text)) continue;
      seen.add(text);
      textParts.push(text);
      if (textParts.join('\n').length >= 5000) break;
    }

    if (textParts.length === 0) {
      textParts.push(clip(document.body?.innerText ?? '', 5000));
    }

    const root = document.documentElement;
    const maxY = Math.max(0, root.scrollHeight - window.innerHeight);

    return {
      url: location.href,
      title: document.title,
      text: textParts.join('\n').slice(0, 5000),
      elements,
      scroll: {
        y: Math.round(window.scrollY),
        maxY: Math.round(maxY),
        viewportHeight: window.innerHeight,
      },
    };
  }, REF_ATTRIBUTE);
}

export function locatorForRef(page: Page, ref: string) {
  return page.locator(`[${REF_ATTRIBUTE}="${ref}"]`).first();
}
