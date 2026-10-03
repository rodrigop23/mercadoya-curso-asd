import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { z } from 'zod';
import type { Order } from '@/lib/orders';
import { productThumbnailPath, type Product } from '@/lib/products';

const entrySchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(2_147_483_647),
  title: z.string(),
  thumbnailPath: z.string().nullable(),
  unitAmount: z.number().int().nonnegative(),
});
const cartSchema = z.object({
  items: z.array(entrySchema).max(20),
  checkoutKey: z.uuid().nullable(),
  pendingOrderId: z.uuid().nullable(),
  redirected: z.boolean(),
  failureReason: z.string().nullable().default(null),
});
type CartState = z.infer<typeof cartSchema>;
export type CartEntry = z.infer<typeof entrySchema>;
const emptyCart: CartState = {
  items: [],
  checkoutKey: null,
  pendingOrderId: null,
  redirected: false,
  failureReason: null,
};
const storageKey = (owner: string) => `mercadoya:cart:v1:${owner}`;

function persistCart(owner: string, state: CartState) {
  try {
    localStorage.setItem(storageKey(owner), JSON.stringify(state));
  } catch {
    /* El carrito continúa en memoria si el navegador bloquea almacenamiento. */
  }
}

function readCart(owner: string): CartState {
  try {
    const result = cartSchema.safeParse(
      JSON.parse(localStorage.getItem(storageKey(owner)) ?? 'null'),
    );
    return result.success ? result.data : emptyCart;
  } catch {
    return emptyCart;
  }
}

type CartContextValue = CartState & {
  count: number;
  locked: boolean;
  setQuantity(product: Product, quantity: number): void;
  remove(productId: string): void;
  beginCheckout(): string;
  setPendingOrder(orderId: string): void;
  markRedirected(): void;
  releaseCheckout(reason?: string): void;
  completeOrder(order: Order): void;
};
const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ owner, children }: { owner: string; children: ReactNode }) {
  const [state, setState] = useState<CartState>(() => {
    if (owner === 'loading') return emptyCart;
    const saved = readCart(owner);
    if (owner === 'guest' || saved.checkoutKey) return saved;
    const guest = readCart('guest');
    const items = [...saved.items];
    for (const item of guest.items) {
      const existing = items.find((entry) => entry.productId === item.productId);
      if (existing) existing.quantity = Math.min(2_147_483_647, existing.quantity + item.quantity);
      else if (items.length < 20) items.push(item);
    }
    return { ...saved, items };
  });
  useEffect(() => {
    if (owner === 'loading') return;
    try {
      localStorage.setItem(storageKey(owner), JSON.stringify(state));
      if (owner !== 'guest') localStorage.removeItem(storageKey('guest'));
    } catch {
      /* El carrito sigue funcionando si el navegador bloquea almacenamiento. */
    }
  }, [owner, state]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey(owner)) setState(readCart(owner));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [owner]);
  const locked = owner === 'loading' || Boolean(state.checkoutKey || state.pendingOrderId);
  const releaseCheckout = useCallback(
    (reason?: string) =>
      setState((current) => ({
        ...current,
        checkoutKey: null,
        pendingOrderId: null,
        redirected: false,
        failureReason: reason ?? current.failureReason,
      })),
    [],
  );
  const setPendingOrder = useCallback(
    (pendingOrderId: string) =>
      setState((current) =>
        current.pendingOrderId === pendingOrderId ? current : { ...current, pendingOrderId },
      ),
    [],
  );
  const completeOrder = useCallback((order: Order) => {
    setState((current) => {
      if (current.pendingOrderId !== order.id && current.checkoutKey !== order.id) return current;
      const purchased = order.items ?? [{ productId: order.productId, quantity: order.quantity }];
      const items = current.items
        .map((item) => ({
          ...item,
          quantity:
            item.quantity -
            (purchased.find((line) => line.productId === item.productId)?.quantity ?? 0),
        }))
        .filter((item) => item.quantity > 0);
      return { ...emptyCart, items };
    });
  }, []);
  return (
    <CartContext.Provider
      value={{
        ...state,
        locked,
        count: state.items.reduce((sum, item) => sum + item.quantity, 0),
        setQuantity(product, quantity) {
          const previous = state.items.find((item) => item.productId === product.id)?.quantity ?? 0;
          if (
            locked ||
            !Number.isSafeInteger(quantity) ||
            quantity < 0 ||
            (quantity > product.stock && quantity >= previous)
          )
            return;
          setState((current) => {
            const items = current.items.filter((item) => item.productId !== product.id);
            if (quantity > 0) {
              if (items.length >= 20) return current;
              const entry = {
                productId: product.id,
                quantity,
                title: product.title,
                thumbnailPath: productThumbnailPath(product.imagePath),
                unitAmount: Math.round(product.price * 100),
              };
              const index = current.items.findIndex((item) => item.productId === product.id);
              items.splice(index < 0 ? items.length : index, 0, entry);
            }
            return { ...current, items };
          });
        },
        remove(productId) {
          if (!locked)
            setState((current) => ({
              ...current,
              items: current.items.filter((item) => item.productId !== productId),
            }));
        },
        beginCheckout() {
          const key = state.checkoutKey ?? crypto.randomUUID();
          const next = { ...state, checkoutKey: key, failureReason: null };
          // Guardar antes del POST permite recuperar una respuesta perdida o un cierre de pestaña.
          persistCart(owner, next);
          setState(next);
          return key;
        },
        setPendingOrder,
        markRedirected() {
          const next = { ...state, redirected: true };
          persistCart(owner, next);
          setState(next);
        },
        releaseCheckout,
        completeOrder,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const cart = useContext(CartContext);
  if (!cart) throw new Error('El carrito requiere CartProvider.');
  return cart;
}
