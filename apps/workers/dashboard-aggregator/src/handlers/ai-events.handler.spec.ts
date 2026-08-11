/**
 * Unit tests for AI event handler.
 */

import { handleAiSynthesisCompleted } from './ai-events.handler';
import {
  aiSynthesisSucceeded,
  aiSynthesisFailed,
  TENANT_A,
} from '../../test/fixtures/outbox-events.fixtures';
import { Keys } from '../redis/keys';
import type { MutationCmd } from '../redis/aggregate.store';

function zincrBy(cmds: MutationCmd[], key: string, member: string): number {
  for (const cmd of cmds) {
    if (cmd[0] === 'ZINCRBY' && cmd[1] === key && cmd[3] === member) {
      return cmd[2] as number;
    }
  }
  return 0;
}

describe('handleAiSynthesisCompleted', () => {
  it('adds affected area entries for a succeeded synthesis', () => {
    const cmds = handleAiSynthesisCompleted(aiSynthesisSucceeded);
    expect(zincrBy(cmds, Keys.affectedArea(TENANT_A), 'authentication')).toBeCloseTo(0.95);
    expect(zincrBy(cmds, Keys.affectedArea(TENANT_A), 'billing')).toBeCloseTo(0.7);
  });

  it('emits no commands for a failed synthesis', () => {
    const cmds = handleAiSynthesisCompleted(aiSynthesisFailed);
    expect(cmds.length).toBe(0);
  });

  it('deduplicates area labels', () => {
    const event = {
      ...aiSynthesisSucceeded,
      payload: {
        ...aiSynthesisSucceeded.payload,
        affectedAreas: [
          { areaLabel: 'authentication', confidence: '0.9' },
          { areaLabel: 'AUTHENTICATION', confidence: '0.8' }, // duplicate case-insensitive
          { areaLabel: 'billing', confidence: '0.5' },
        ],
      },
    };
    const cmds = handleAiSynthesisCompleted(event);
    const authCmds = cmds.filter(
      (c) => c[0] === 'ZINCRBY' && (c[3] as string) === 'authentication',
    );
    expect(authCmds.length).toBe(1);
  });
});
