import type { OrderItem } from '@mercadoya/contracts';
import { priceFormatter } from '@/lib/products';
import { ProductThumbnail } from './product-thumbnail';

export function OrderItems({ items, totalAmount }: { items: OrderItem[]; totalAmount: number }) {
  return (
    <div className="flex flex-col gap-5">
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.productId} className="flex items-center gap-4 py-5 first:pt-0">
            <ProductThumbnail path={item.thumbnailPath} title={item.title} />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold [overflow-wrap:anywhere]">{item.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {item.quantity} {item.quantity === 1 ? 'unidad' : 'unidades'} ×{' '}
                {priceFormatter.format(item.unitAmount / 100)}
              </p>
              <p className="mt-2 font-semibold tabular-nums">
                {priceFormatter.format((item.unitAmount * item.quantity) / 100)}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-4 border-t border-border pt-5">
        <span className="font-semibold">Total de productos</span>
        <span className="text-xl font-semibold tabular-nums">
          {priceFormatter.format(totalAmount / 100)}
        </span>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Los impuestos aplicables se muestran al pagar.
      </p>
    </div>
  );
}
