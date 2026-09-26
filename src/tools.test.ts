import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolRegistry } from './tools.js';

test('registers browser, extraction, tab, and memory tools', () => {
  const names = new ToolRegistry().names();

  for (const expected of [
    'navigate',
    'click',
    'hover',
    'check',
    'new_tab',
    'switch_tab',
    'extract_text',
    'extract_table',
    'remember',
    'forget',
  ]) {
    assert.ok(names.includes(expected as (typeof names)[number]), `missing ${expected}`);
  }

  assert.ok(!names.includes('finish'));
  assert.ok(!names.includes('handoff'));
});
