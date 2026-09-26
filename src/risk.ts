import type { AgentAction, PageObservation } from './types.js';

const HIGH_IMPACT = /\b(buy|purchase|place order|pay now|send money|wire|transfer funds|delete account|close account|delete repository|delete project|publish|send email)\b/i;

export function assessRisk(action: AgentAction, observation: PageObservation): string | null {
  if (action.action === 'navigate' && action.url) {
    try {
      const url = new URL(action.url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return `navigation to non-http(s) URL ${url.protocol}`;
      }
    } catch {
      return 'navigation to an invalid URL';
    }
  }

  if (action.action !== 'click') return null;
  const element = observation.elements.find((candidate) => candidate.ref === action.target);
  if (!element) return null;
  const label = `${element.name} ${element.text}`.trim();
  if (HIGH_IMPACT.test(label)) {
    return `high-impact click on “${label.slice(0, 120)}”`;
  }
  return null;
}
