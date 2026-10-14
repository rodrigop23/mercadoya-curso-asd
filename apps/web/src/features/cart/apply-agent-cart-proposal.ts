import type { CartProposal, CartResult } from '@/lib/agent-actions';
import { productThumbnailPath, type Product } from '../../lib/products';
import type { CartEntry } from './cart-context';

export function applyAgentCartProposal<T extends { items: CartEntry[]; locked: boolean }>(
  cart: T,
  proposal: CartProposal,
  product: Product | null,
): { cart: T; result: CartResult } {
  const fail = (reason: NonNullable<CartResult['reason']>) => ({
    cart,
    result: { applied: false, reason },
  });
  if (cart.locked) return fail('checkout_locked');
  if (!product) return fail('not_found');
  if (
    typeof product.title !== 'string' ||
    typeof product.imagePath !== 'string' ||
    product.id !== proposal.product_id ||
    !Number.isSafeInteger(proposal.quantity) ||
    proposal.quantity < 1 ||
    proposal.quantity > 20 ||
    !Number.isSafeInteger(product.stock) ||
    product.stock < 0 ||
    !Number.isFinite(product.price) ||
    product.price < 0 ||
    !Number.isSafeInteger(Math.round(product.price * 100))
  )
    return fail('invalid');
  const previous = cart.items.find((entry) => entry.productId === product.id);
  const quantity = (previous?.quantity ?? 0) + proposal.quantity;
  if (!Number.isSafeInteger(quantity) || quantity > 2_147_483_647) return fail('invalid');
  if (quantity > product.stock) return fail('stock');
  if (!previous && cart.items.length >= 20) return fail('cart_full');
  const entry: CartEntry = {
    productId: product.id,
    title: product.title,
    quantity,
    thumbnailPath: productThumbnailPath(product.imagePath),
    unitAmount: Math.round(product.price * 100),
  };
  const items = previous
    ? cart.items.map((item) => (item.productId === product.id ? entry : item))
    : [...cart.items, entry];
  return { cart: { ...cart, items }, result: { applied: true, quantity_in_cart: quantity } };
}

/** Conserva el primer resultado junto a las líneas para recuperarlo después de una recarga. */
export function applyAgentCartProposalOnce<
  T extends {
    items: CartEntry[];
    locked: boolean;
    agentResults: Record<string, CartResult>;
  },
>(
  cart: T,
  proposal: CartProposal,
  product: Product | null,
  failure?: CartResult,
): { cart: T; result: CartResult } {
  const saved = cart.agentResults[proposal.action_id];
  if (saved) {
    const entries = Object.entries(cart.agentResults);
    return {
      cart:
        entries.length > 50
          ? { ...cart, agentResults: Object.fromEntries(entries.slice(-50)) }
          : cart,
      result: saved,
    };
  }
  const outcome = failure
    ? { cart, result: failure }
    : applyAgentCartProposal(cart, proposal, product);
  return {
    cart: {
      ...outcome.cart,
      agentResults: Object.fromEntries(
        Object.entries({ ...cart.agentResults, [proposal.action_id]: outcome.result }).slice(-50),
      ),
    },
    result: outcome.result,
  };
}
