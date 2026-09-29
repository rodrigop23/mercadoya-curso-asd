import { Text } from '@react-email/components';
import { OrderEmailLayout, type OrderEmailProps } from './layout.js';

export function OrderRejectedPayment(props: OrderEmailProps & { reason: string }) {
  return (
    <OrderEmailLayout {...props} title="El pago no se completó">
      <Text>
        Tu pedido fue rechazado porque el pago falló. La liberación del stock se procesa por
        separado.
      </Text>
      <Text>Motivo: {props.reason}</Text>
    </OrderEmailLayout>
  );
}
