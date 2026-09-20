import { developmentHandoffInputSchema, developmentHandoffPacketSchema } from '@/shared/contracts/development-handoff';
import { prepareDevelopmentHandoff, verifyDevelopmentHandoff } from '@/main/agent-cli/development-handoff';

export function isHandoffCommand(command: string): command is 'handoff prepare' | 'handoff verify' {
  return command === 'handoff prepare' || command === 'handoff verify';
}

/** Intentionally offline: no worker, model, shell, source path or library access. */
export function runHandoffCommand(command: 'handoff prepare' | 'handoff verify', input: unknown) {
  if (command === 'handoff prepare') {
    const parsed = developmentHandoffInputSchema.safeParse(input);
    if (!parsed.success)
      throw Object.assign(new Error('Invalid handoff input; check the documented schema and limits'), {
        code: 'AIY_AGENT_INVALID_INPUT',
      });
    return prepareDevelopmentHandoff(parsed.data);
  }
  const parsed = developmentHandoffPacketSchema.safeParse(input);
  if (!parsed.success)
    throw Object.assign(new Error('Expected the complete handoff packet, not the CLI envelope'), {
      code: 'AIY_AGENT_INVALID_INPUT',
    });
  return verifyDevelopmentHandoff(parsed.data);
}
