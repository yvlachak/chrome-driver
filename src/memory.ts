import type {
  AgentAction,
  HarnessMemorySnapshot,
  MemoryEpisode,
  MemoryFact,
  PageObservation,
  StepRecord,
} from './types.js';

export interface HarnessMemoryOptions {
  recentLimit?: number;
  episodeSize?: number;
  maxEpisodes?: number;
  maxFacts?: number;
  maxVisitedPages?: number;
  contextBudget?: number;
}

const clip = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max);

function actionArgument(action: AgentAction) {
  return action.target || action.url || action.tab || action.value || action.key || action.option || '';
}

function failureSignature(record: StepRecord) {
  return JSON.stringify({
    action: record.action.action,
    target: record.action.target,
    url: record.action.url,
    tab: record.action.tab,
    value: clip(record.action.value, 120),
    result: clip(record.result, 180),
  });
}

export class HarnessMemory {
  readonly goal: string;

  private readonly recentLimit: number;
  private readonly episodeSize: number;
  private readonly maxEpisodes: number;
  private readonly maxFacts: number;
  private readonly maxVisitedPages: number;
  private readonly contextBudget: number;

  private readonly recent: StepRecord[] = [];
  private readonly episodeBuffer: StepRecord[] = [];
  private readonly episodes: MemoryEpisode[] = [];
  private readonly facts: MemoryFact[] = [];
  private readonly failures = new Map<string, number>();
  private readonly pages = new Map<string, { url: string; title: string; visits: number; lastStep: number }>();
  private factSequence = 0;

  constructor(goal: string, options: HarnessMemoryOptions = {}) {
    this.goal = goal;
    this.recentLimit = options.recentLimit ?? 8;
    this.episodeSize = options.episodeSize ?? 6;
    this.maxEpisodes = options.maxEpisodes ?? 12;
    this.maxFacts = options.maxFacts ?? 32;
    this.maxVisitedPages = options.maxVisitedPages ?? 16;
    this.contextBudget = options.contextBudget ?? 11_000;
  }

  noteObservation(observation: PageObservation, step: number) {
    const existing = this.pages.get(observation.url);
    this.pages.set(observation.url, {
      url: observation.url,
      title: clip(observation.title, 180),
      visits: (existing?.visits ?? 0) + 1,
      lastStep: step,
    });

    if (this.pages.size > this.maxVisitedPages) {
      const oldest = [...this.pages.values()].sort((a, b) => a.lastStep - b.lastStep)[0];
      if (oldest) this.pages.delete(oldest.url);
    }
  }

  pin(text: string, step: number, url: string, source: MemoryFact['source'] = 'agent') {
    const normalized = clip(text, 700);
    if (!normalized) return null;
    const key = normalized.toLowerCase();
    const existing = this.facts.find((fact) => fact.text.toLowerCase() === key);
    if (existing) return existing;

    const fact: MemoryFact = {
      id: `m${++this.factSequence}`,
      text: normalized,
      source,
      step,
      url,
    };
    this.facts.push(fact);
    while (this.facts.length > this.maxFacts) this.facts.shift();
    return fact;
  }

  forget(query: string) {
    const needle = clip(query, 200).toLowerCase();
    if (!needle) return 0;
    const before = this.facts.length;
    for (let index = this.facts.length - 1; index >= 0; index -= 1) {
      const fact = this.facts[index];
      if (fact && (fact.id.toLowerCase() === needle || fact.text.toLowerCase().includes(needle))) {
        this.facts.splice(index, 1);
      }
    }
    return before - this.facts.length;
  }

  record(record: StepRecord) {
    if (record.result.startsWith('failed:')) {
      const signature = failureSignature(record);
      this.failures.set(signature, (this.failures.get(signature) ?? 0) + 1);
    }

    this.recent.push(record);
    while (this.recent.length > this.recentLimit) {
      const shifted = this.recent.shift();
      if (shifted) this.episodeBuffer.push(shifted);
    }
    if (this.episodeBuffer.length >= this.episodeSize) this.compactEpisode();
  }

  private compactEpisode() {
    if (this.episodeBuffer.length === 0) return;
    const records = this.episodeBuffer.splice(0, this.episodeBuffer.length);
    const summary = records
      .map((record) => {
        const argument = clip(actionArgument(record.action), 80);
        const action = argument ? `${record.action.action}(${argument})` : record.action.action;
        return `${record.step}:${action}=>${clip(record.result, 140)} @ ${clip(record.url, 180)}`;
      })
      .join(' | ');

    this.episodes.push({
      fromStep: records[0]?.step ?? 0,
      toStep: records[records.length - 1]?.step ?? 0,
      summary: clip(summary, 1800),
    });
    while (this.episodes.length > this.maxEpisodes) this.episodes.shift();
  }

  private episodeView() {
    const view = [...this.episodes];
    if (this.episodeBuffer.length > 0) {
      const records = this.episodeBuffer;
      view.push({
        fromStep: records[0]?.step ?? 0,
        toStep: records[records.length - 1]?.step ?? 0,
        summary: clip(
          records
            .map((record) => `${record.step}:${record.action.action}=>${clip(record.result, 120)}`)
            .join(' | '),
          1200,
        ),
      });
    }
    return view;
  }

  snapshot(): HarnessMemorySnapshot {
    return {
      goal: this.goal,
      pinnedFacts: [...this.facts],
      episodes: this.episodeView(),
      recentSteps: [...this.recent],
      failures: [...this.failures.entries()]
        .map(([signature, count]) => ({ signature, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12),
      visitedPages: [...this.pages.values()]
        .sort((a, b) => b.lastStep - a.lastStep)
        .slice(0, this.maxVisitedPages),
    };
  }

  context(maxChars = this.contextBudget) {
    const snapshot = this.snapshot();
    const sections: string[] = [];

    sections.push(
      `PINNED FACTS:\n${snapshot.pinnedFacts.length ? snapshot.pinnedFacts.map((fact) => `${fact.id}: ${fact.text}`).join('\n') : '(none)'}`,
    );

    sections.push(
      `RECENT STEPS:\n${snapshot.recentSteps.length
        ? snapshot.recentSteps
            .map((record) => {
              const argument = clip(actionArgument(record.action), 100);
              return `${record.step}. ${record.action.action}${argument ? `(${argument})` : ''} -> ${clip(record.result, 240)}`;
            })
            .join('\n')
        : '(none)'}`,
    );

    sections.push(
      `KNOWN FAILURES:\n${snapshot.failures.length
        ? snapshot.failures.map((item) => `x${item.count} ${clip(item.signature, 350)}`).join('\n')
        : '(none)'}`,
    );

    sections.push(
      `VISITED PAGES:\n${snapshot.visitedPages.length
        ? snapshot.visitedPages.map((page) => `${page.title || '(untitled)'} | ${page.url} | visits=${page.visits}`).join('\n')
        : '(none)'}`,
    );

    const episodeText = snapshot.episodes.length
      ? snapshot.episodes.map((episode) => `${episode.fromStep}-${episode.toStep}: ${episode.summary}`).join('\n')
      : '(none)';
    sections.push(`OLDER EPISODES:\n${episodeText}`);

    let remaining = maxChars;
    const output: string[] = [];
    for (const section of sections) {
      if (remaining <= 0) break;
      const bounded = section.slice(0, remaining);
      output.push(bounded);
      remaining -= bounded.length + 2;
    }
    return output.join('\n\n');
  }
}
