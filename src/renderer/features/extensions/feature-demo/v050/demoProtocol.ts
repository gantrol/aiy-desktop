import type { Locale } from '@/shared/contracts';

export const DEMO_CHANNEL = 'aiy-v050-demo';
export const demoRoles = ['note', 'petal', 'flower', 'workspace'] as const;
export type DemoRole = (typeof demoRoles)[number];
export const demoTargets = [
  'note',
  'petal',
  'flower',
  'openMain',
  'prompt',
  'generate',
  'result',
  'magnify',
  'variant',
  'gif',
  'motionPrompt',
  'motionPlan',
  'motionConfirm',
  'motionFrame',
  'motionPlay',
  'motionFace',
] as const;
export type DemoTarget = (typeof demoTargets)[number];
export interface DemoEnvelope {
  channel: typeof DEMO_CHANNEL;
  token: string;
  role: DemoRole;
}
export type DemoHostMessage = DemoEnvelope &
  ({ type: 'snapshot'; collected: boolean; time: number } | { type: 'status-request' });
export type DemoWindowDetail =
  | { type: 'ready' }
  | { type: 'motion-ready' }
  | { type: 'target'; target: DemoTarget; point: [number, number] }
  | { type: 'failed' };
export type DemoWindowMessage = DemoEnvelope & DemoWindowDetail;

export function demoWindowUrl(role: DemoRole, token: string, locale: Locale) {
  const url = new URL('demo-petals.html', location.href);
  url.search = new URLSearchParams({ role, token, locale }).toString();
  url.hash = '';
  return url.href;
}
