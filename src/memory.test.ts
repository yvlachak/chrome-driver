import assert from 'node:assert/strict';
import test from 'node:test';
import { HarnessMemory } from './memory.js';
import type { AgentAction, PageObservation, StepRecord } from './types.js';

function action(name: AgentAction['action'], value = ''): AgentAction {
  return {
    action: name,
    target: '',
    value,
    url: '',
    key: '',
    option: '',
    tab: '',
    reason: '',
    answer: '',
  };
}

function record(step: number, result = 'ok'): StepRecord {
  return {
    step,
    action: action('wait', String(step * 100)),
    result,
    url: `https://example.com/${step}`,
  };
}

function repeatedFailure(step: number): StepRecord {
  const failedAction = action('click');
  failedAction.target = 'e7';
  return {
    step,
    action: failedAction,
    result: 'failed: timeout',
    url: 'https://example.com/form',
  };
}

const observation: PageObservation = {
  url: 'https://example.com',
  title: 'Example',
  text: 'Example page',
  elements: [],
  tabs: [{ index: 0, url: 'https://example.com', title: 'Example', active: true }],
  scroll: { y: 0, maxY: 0, viewportHeight: 800 },
};

test('pins grounded facts without duplicates and supports forgetting', () => {
  const memory = new HarnessMemory('test goal');
  const first = memory.pin('Invoice total is $1,882', 1, observation.url);
  const duplicate = memory.pin('Invoice total is $1,882', 2, observation.url);

  assert.equal(first?.id, 'm1');
  assert.equal(duplicate?.id, 'm1');
  assert.equal(memory.snapshot().pinnedFacts.length, 1);
  assert.equal(memory.forget('invoice total'), 1);
  assert.equal(memory.snapshot().pinnedFacts.length, 0);
});

test('keeps recent steps high resolution and deterministically compacts older steps', () => {
  const memory = new HarnessMemory('test goal', { recentLimit: 2, episodeSize: 2, maxEpisodes: 4 });
  for (let step = 1; step <= 6; step += 1) memory.record(record(step));

  const snapshot = memory.snapshot();
  assert.deepEqual(snapshot.recentSteps.map((item) => item.step), [5, 6]);
  assert.equal(snapshot.episodes.length, 2);
  assert.match(snapshot.episodes[0]?.summary ?? '', /1:wait/);
  assert.match(snapshot.episodes[1]?.summary ?? '', /3:wait/);
});

test('tracks repeated failed action patterns and visited pages', () => {
  const memory = new HarnessMemory('test goal');
  memory.noteObservation(observation, 1);
  memory.noteObservation(observation, 2);
  memory.record(repeatedFailure(1));
  memory.record(repeatedFailure(2));

  const snapshot = memory.snapshot();
  assert.equal(snapshot.visitedPages[0]?.visits, 2);
  assert.equal(snapshot.failures.length, 1);
  assert.equal(snapshot.failures[0]?.count, 2);
  assert.match(memory.context(), /KNOWN FAILURES/);
});
