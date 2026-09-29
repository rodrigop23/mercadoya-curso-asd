import { Text } from '@react-email/components';
import { OrderEmailLayout, type OrderEmailProps } from './layout.js';

export function OrderConfirmed(props: OrderEmailProps) {
  return (
    <OrderEmailLayout {...props} title="Pedido confirmado">
      <Text>El pago se completó y tu pedido quedó confirmado.</Text>
    </OrderEmailLayout>
  );
}
