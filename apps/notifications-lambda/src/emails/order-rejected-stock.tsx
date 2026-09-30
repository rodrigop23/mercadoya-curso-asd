import { Text } from '@react-email/components';
import type { InventoryRejectedEvent } from '@mercadoya/contracts';
import { OrderEmailLayout, type OrderEmailProps } from './layout.js';

const reasons: Record<InventoryRejectedEvent['reason'], string> = {
  invalid_quantity: 'La cantidad solicitada no es válida.',
  product_not_found: 'El producto no está disponible.',
  insufficient_stock: 'No hay stock suficiente para la cantidad solicitada.',
  stock_limit: 'La cantidad supera el límite de stock permitido.',
};

export function OrderRejectedStock(
  props: OrderEmailProps & { reason: InventoryRejectedEvent['reason'] },
) {
  return (
    <OrderEmailLayout {...props} title="No pudimos completar tu pedido">
      <Text>{reasons[props.reason]} No se inició el pago.</Text>
      <Text>Motivo: {props.reason}</Text>
    </OrderEmailLayout>
  );
}
