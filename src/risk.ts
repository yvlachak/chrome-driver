import type { AgentAction, PageObservation } from './types.js';

const HIGH_IMPACT = /\b(buy|purchase|place order|pay now|send|wire|transfer funds|delete|close account|publish|submit order|confirm payment)\b/i;

export function assessRisk(action: AgentAction, observation: PageObservation): string | null {
  if ((action.action === 'navigate' || action.action === 'new_tab') && action.url) {
    try {
      const url = new URL(action.url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return `navigation to non-http(s) URL ${url.protocol}`;
      }
    } catch {
      return 'navigation to an invalid URL';
    }
  }

  const elementActions = new Set(['click', 'check', 'uncheck', 'press']);
  if (!elementActions.has(action.action) || !action.target) return null;
  if (action.action === 'press' && !/^(enter|space)$/i.test(action.key || 'Enter')) return null;

  const element = observation.elements.find((candidate) => candidate.ref === action.target);
  if (!element) return null;
  const label = `${element.name} ${element.text}`.trim();
  if (HIGH_IMPACT.test(label)) {
    return `high-impact ${action.action} on “${label.slice(0, 120)}”`;
  }
  return null;
}
