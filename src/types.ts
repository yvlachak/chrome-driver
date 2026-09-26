export const ACTION_NAMES = [
  'navigate',
  'click',
  'fill',
  'press',
  'select',
  'scroll',
  'wait',
  'back',
  'finish',
  'handoff',
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

export interface AgentAction {
  action: ActionName;
  target: string;
  value: string;
  url: string;
  key: string;
  option: string;
  reason: string;
  answer: string;
}

export interface ElementObservation {
  ref: string;
  tag: string;
  role: string;
  inputType: string;
  name: string;
  text: string;
  href: string;
  disabled: boolean;
}

export interface PageObservation {
  url: string;
  title: string;
  text: string;
  elements: ElementObservation[];
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
}

export interface NanoStatus {
  supported: boolean;
  availability: string;
  state: 'idle' | 'initializing' | 'ready' | 'error';
  progress: number;
  error: string;
}
