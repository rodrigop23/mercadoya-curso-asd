import { describe, expect, it } from 'vitest';
import { applyAgentCartProposal } from './apply-agent-cart-proposal';
import type { CartEntry } from './cart-context';
import type { CartProposal } from '@/lib/agent-actions';
import type { Product } from '@/lib/products';

const product: Product = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Producto actual',
  price: 12.9,
  stock: 30,
  imagePath: 'item-full.webp',
  description: '',
  createdAt: '',
  updatedAt: '',
};
const proposal: CartProposal = {
  kind: 'add_to_cart',
  action_id: '12345678-1234-5678-9234-567812345678',
  product_id: product.id,
  quantity: 2,
  title: 'Título anterior',
  unit_price_pen: '10.00',
  stock: 10,
};
const empty = { items: [] as CartEntry[], locked: false };
describe('applyAgentCartProposal', () => {
  it('agrega con datos actuales y convierte el precio a céntimos', () => {
    const { cart, result } = applyAgentCartProposal(empty, proposal, product);
    expect(result).toEqual({ applied: true, quantity_in_cart: 2 });
    expect(cart.items[0]).toEqual({
      productId: product.id,
      quantity: 2,
      title: product.title,
      unitAmount: 1290,
      thumbnailPath: 'item-thumb.webp',
    });
    expect(empty.items).toEqual([]);
    expect(
      applyAgentCartProposal(empty, proposal, { ...product, price: 1.005 }).cart.items[0]
        ?.unitAmount,
    ).toBe(Math.round(1.005 * 100));
  });
  it('suma a la línea existente y respeta su posición sin mutar', () => {
    const first = applyAgentCartProposal(empty, proposal, product).cart;
    const next = applyAgentCartProposal(first, proposal, { ...product, price: 14.5 });
    expect(next.cart.items).toHaveLength(1);
    expect(next.cart.items[0]?.quantity).toBe(4);
    expect(next.cart.items[0]?.unitAmount).toBe(1450);
    expect(first.items[0]?.quantity).toBe(2);
  });
  it('rechaza stock insuficiente para la cantidad acumulada', () => {
    const first = applyAgentCartProposal(empty, proposal, product).cart;
    expect(applyAgentCartProposal(first, proposal, { ...product, stock: 3 })).toEqual({
      cart: first,
      result: { applied: false, reason: 'stock' },
    });
  });
  it('respeta 20 líneas y permite sumar a una existente', () => {
    const entry = applyAgentCartProposal(empty, proposal, product).cart.items[0]!;
    const full = {
      ...empty,
      items: Array.from({ length: 20 }, (_, index) => ({ ...entry, productId: String(index) })),
    };
    expect(applyAgentCartProposal(full, proposal, product).result.reason).toBe('cart_full');
    full.items[0] = entry;
    expect(applyAgentCartProposal(full, proposal, product).result.applied).toBe(true);
  });
  it('rechaza checkout bloqueado, producto inexistente y cantidades inválidas', () => {
    expect(
      applyAgentCartProposal({ ...empty, locked: true }, proposal, product).result.reason,
    ).toBe('checkout_locked');
    expect(applyAgentCartProposal(empty, proposal, null).result.reason).toBe('not_found');
    for (const quantity of [0, 21, 1.5, NaN]) {
      expect(applyAgentCartProposal(empty, { ...proposal, quantity }, product).result.reason).toBe(
        'invalid',
      );
    }
    expect(applyAgentCartProposal(empty, proposal, { ...product, id: 'other' }).result.reason).toBe(
      'invalid',
    );
  });
});

it('no suma una acción aplicada al rehidratar o responder dos veces', async () => {
  const { applyAgentCartProposalOnce } = await import('./apply-agent-cart-proposal');
  const first = applyAgentCartProposalOnce({ ...empty, agentResults: {} }, proposal, product);
  const hydrated = JSON.parse(JSON.stringify(first.cart));
  const second = applyAgentCartProposalOnce(hydrated, proposal, { ...product, price: 20 });
  expect(second.result).toEqual({ applied: true, quantity_in_cart: 2 });
  expect(second.cart.items).toHaveLength(1);
  expect(second.cart.items[0]?.quantity).toBe(2);
  expect(second.cart.items[0]?.unitAmount).toBe(1290);
});

it('conserva los 50 resultados más recientes por inserción y no reordena un duplicado', async () => {
  const { applyAgentCartProposalOnce } = await import('./apply-agent-cart-proposal');
  let cart = { ...empty, agentResults: {} as Record<string, { applied: boolean }> };
  for (let index = 0; index < 52; index++) {
    cart = applyAgentCartProposalOnce(
      cart,
      { ...proposal, action_id: `action-${index}` },
      null,
    ).cart;
  }
  const keys = Object.keys(cart.agentResults);
  expect(keys).toHaveLength(50);
  expect(keys[0]).toBe('action-2');
  expect(keys.at(-1)).toBe('action-51');
  const duplicate = applyAgentCartProposalOnce(
    cart,
    { ...proposal, action_id: 'action-2' },
    product,
  );
  expect(duplicate.cart).toBe(cart);
  expect(Object.keys(duplicate.cart.agentResults)).toEqual(keys);
  expect(duplicate.result.applied).toBe(false);
});

it('recorta registros anteriores de más de 50 incluso al recuperar un resultado', async () => {
  const { applyAgentCartProposalOnce } = await import('./apply-agent-cart-proposal');
  const agentResults = Object.fromEntries(
    Array.from({ length: 60 }, (_, index) => [
      `action-${index}`,
      { applied: false as const, reason: 'stock' as const },
    ]),
  );
  const cart = { ...empty, agentResults };
  const outcome = applyAgentCartProposalOnce(
    cart,
    { ...proposal, action_id: 'action-59' },
    product,
  );
  expect(Object.keys(outcome.cart.agentResults)).toHaveLength(50);
  expect(Object.keys(outcome.cart.agentResults)[0]).toBe('action-10');
  expect(outcome.result).toBe(agentResults['action-59']);
  expect(outcome.cart.items).toBe(cart.items);
});
