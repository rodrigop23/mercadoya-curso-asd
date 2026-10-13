import { z } from 'zod';

const money = z.string().regex(/^(0|[1-9][0-9]*)\.[0-9]{2}$/);
const actionId = z.uuid();
export const cartProposalSchema = z.strictObject({
  kind: z.literal('add_to_cart'),
  action_id: actionId,
  product_id: z.uuid(),
  title: z.string().min(1),
  unit_price_pen: money,
  quantity: z.number().int().min(1).max(20),
  stock: z.number().int().nonnegative(),
});
export const cancelProposalSchema = z.strictObject({
  kind: z.literal('cancel_order'),
  action_id: actionId,
  order_id: z.uuid(),
  status: z.literal('pending'),
  total_pen: money.nullable(),
  items_count: z.number().int().nonnegative(),
  created_at: z.string().min(1),
});
export const agentProposalSchema = z.discriminatedUnion('kind', [
  cartProposalSchema,
  cancelProposalSchema,
]);
export const cartResultSchema = z.strictObject({
  applied: z.boolean(),
  quantity_in_cart: z.number().int().min(1).max(2_147_483_647).nullable().optional(),
  reason: z
    .enum(['stock', 'cart_full', 'checkout_locked', 'not_found', 'invalid'])
    .nullable()
    .optional(),
});
export const actionResumeSchema = z.strictObject({
  action_id: actionId,
  approved: z.boolean(),
  result: cartResultSchema.nullable().optional(),
});
export type CartProposal = z.infer<typeof cartProposalSchema>;
export type AgentProposal = z.infer<typeof agentProposalSchema>;
export type CartResult = z.infer<typeof cartResultSchema>;
export type ActionResume = z.infer<typeof actionResumeSchema>;

/** Un payload desconocido solo puede rechazarse, nunca se ejecuta. */
export function unknownActionRejection(value: unknown) {
  const parsed = z.object({ action_id: actionId }).safeParse(value);
  return {
    action_id: parsed.success ? parsed.data.action_id : '00000000-0000-0000-0000-000000000000',
    approved: false,
  };
}

/** La tarjeta puede estar abierta en otra pestaña: comprobar el interrupt actual antes del cambio. */
export function isPendingAgentInterrupt(thread: unknown, id: string, actionId?: string): boolean {
  const schema = z.object({
    status: z.literal('interrupted'),
    interrupts: z.record(z.string(), z.array(z.object({ id: z.string(), value: z.unknown() }))),
  });
  const parsed = schema.safeParse(thread);
  if (!parsed.success) return false;
  const interrupts = Object.values(parsed.data.interrupts).flat();
  if (interrupts.length !== 1 || interrupts[0]?.id !== id) return false;
  if (!actionId) return true;
  const proposal = agentProposalSchema.safeParse(interrupts[0].value);
  return proposal.success && proposal.data.action_id === actionId;
}
