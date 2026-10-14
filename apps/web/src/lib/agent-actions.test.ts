import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { actionResumeSchema, agentProposalSchema, unknownActionRejection } from './agent-actions';

const directory = fileURLToPath(
  new URL('../../../../packages/contracts/agent/fixtures/', import.meta.url),
);
describe('contrato compartido', () => {
  for (const name of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
    const fixture = JSON.parse(readFileSync(`${directory}/${name}`, 'utf8'));
    it(name, () => {
      const schema = fixture.type === 'proposal' ? agentProposalSchema : actionResumeSchema;
      expect(schema.safeParse(fixture.payload).success).toBe(fixture.valid);
    });
  }
  it('rechaza acciones desconocidas sin copiar datos privados', () => {
    expect(unknownActionRejection({ token: 'private', kind: 'unknown' })).toEqual({
      action_id: '00000000-0000-0000-0000-000000000000',
      approved: false,
    });
  });
});

it('detecta confirmaciones respondidas, viejas o de otra acción antes del carrito', async () => {
  const { isPendingAgentInterrupt } = await import('./agent-actions');
  const proposal = JSON.parse(readFileSync(`${directory}/cart.json`, 'utf8')).payload;
  const thread = {
    status: 'interrupted',
    interrupts: { task: [{ id: 'current', value: proposal }] },
  };
  expect(isPendingAgentInterrupt(thread, 'current', proposal.action_id)).toBe(true);
  expect(isPendingAgentInterrupt(thread, 'old', proposal.action_id)).toBe(false);
  expect(isPendingAgentInterrupt(thread, 'current', '12345678-1234-5678-9234-567812345679')).toBe(
    false,
  );
  expect(isPendingAgentInterrupt({ ...thread, status: 'idle', interrupts: {} }, 'current')).toBe(
    false,
  );
  expect(isPendingAgentInterrupt({ ...thread, status: 'busy' }, 'current')).toBe(false);
});
