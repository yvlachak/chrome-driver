export const ACTION_NAMES = [
  'navigate',
  'click',
  'fill',
  'clear',
  'press',
  'select',
  'hover',
  'check',
  'uncheck',
  'scroll',
  'wait',
  'back',
  'forward',
  'reload',
  'new_tab',
  'switch_tab',
  'close_tab',
  'find_text',
  'extract_text',
  'extract_table',
  'remember',
  'forget',
  'finish',
  'handoff',
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

export const ACTION_GUIDE: Record<ActionName, string> = {
  navigate: 'Navigate the active tab to an explicit http/https URL using url.',
  click: 'Click an observed element ref using target.',
  fill: 'Replace the contents of an observed editable element using target and value.',
  clear: 'Clear an observed editable element using target.',
  press: 'Press a keyboard key. Set key and optionally target.',
  select: 'Choose an option in an observed select/combobox using target and option.',
  hover: 'Hover an observed element using target.',
  check: 'Check an observed checkbox/radio using target.',
  uncheck: 'Uncheck an observed checkbox using target.',
  scroll: 'Scroll the page. Set value to up, down, top, or bottom.',
  wait: 'Wait briefly for page state to settle. Set value to milliseconds, normally 500-3000.',
  back: 'Navigate the active tab backward in history.',
  forward: 'Navigate the active tab forward in history.',
  reload: 'Reload the active tab.',
  new_tab: 'Open a new user tab. url is optional; blank creates an empty tab.',
  switch_tab: 'Switch to a user tab by the tab index shown in the current observation. Set tab.',
  close_tab: 'Close a user tab. Set tab, or leave blank to close the active user tab.',
  find_text: 'Find text in the document and scroll its first visible match into view. Set value to the text.',
  extract_text: 'Read bounded text from target, or from the current page when target is empty.',
  extract_table: 'Read a table-like element using target. The target should be an observed table/grid ref.',
  remember: 'Pin a concise, grounded fact into harness memory using value.',
  forget: 'Remove pinned memory entries containing value.',
  finish: 'Finish only when the goal is demonstrably complete. Put the result in answer.',
  handoff: 'Request human intervention for CAPTCHA, 2FA, missing credentials, or judgment the agent should not make.',
};

export interface AgentAction {
  action: ActionName;
  target: string;
  value: string;
  url: string;
  key: string;
  option: string;
  tab: string;
  reason: string;
  answer: string;
}

export interface ElementObservation {
  ref: string;
  kind: 'interactive' | 'content';
  tag: string;
  role: string;
  inputType: string;
  name: string;
  text: string;
  href: string;
  value: string;
  disabled: boolean;
  checked: boolean;
  focused: boolean;
}

export interface TabObservation {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

export interface PageObservation {
  url: string;
  title: string;
  text: string;
  elements: ElementObservation[];
  tabs: TabObservation[];
  scroll: {
    y: number;
    maxY: number;
    viewportHeight: number;
  };
}

export interface StepRecord {
  step: number;
  action: AgentAction;
  result: string;
  url: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  message: string;
  data?: string;
  remember?: string[];
}

export interface MemoryFact {
  id: string;
  text: string;
  source: 'agent' | 'tool';
  step: number;
  url: string;
}

export interface MemoryEpisode {
  fromStep: number;
  toStep: number;
  summary: string;
}

export interface HarnessMemorySnapshot {
  goal: string;
  pinnedFacts: MemoryFact[];
  episodes: MemoryEpisode[];
  recentSteps: StepRecord[];
  failures: Array<{ signature: string; count: number }>;
  visitedPages: Array<{ url: string; title: string; visits: number; lastStep: number }>;
}

export type AgentStatus =
  | 'completed'
  | 'needs-human'
  | 'blocked'
  | 'stalled'
  | 'max-steps';

export interface AgentResult {
  status: AgentStatus;
  answer: string;
  steps: StepRecord[];
  memory?: HarnessMemorySnapshot;
}

export interface NanoStatus {
  supported: boolean;
  availability: string;
  state: 'idle' | 'initializing' | 'ready' | 'error';
  progress: number;
  error: string;
}
