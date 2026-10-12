import { Body, Container, Head, Heading, Html, Preview, Text } from '@react-email/components';
import type { ReactNode } from 'react';
import type { CartItem } from '@mercadoya/contracts';

export type OrderEmailProps = {
  orderId: string;
  productId: string;
  quantity: number;
  items?: CartItem[];
};

export function OrderEmailLayout({
  title,
  orderId,
  productId,
  quantity,
  items,
  children,
}: OrderEmailProps & { title: string; children: ReactNode }) {
  return (
    <Html lang="es">
      <Head />
      <Preview>{title}</Preview>
      <Body style={{ backgroundColor: '#f5f5f5', fontFamily: 'Arial, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '24px', maxWidth: '560px' }}>
          <Text>MercadoYa</Text>
          <Heading as="h1" style={{ fontSize: '24px' }}>
            {title}
          </Heading>
          {children}
          <Text>Pedido: {orderId}</Text>
          {items ? (
            items.map((item) => (
              <Text key={item.productId}>
                Producto: {item.productId}. Cantidad: {item.quantity}
              </Text>
            ))
          ) : (
            <>
              <Text>Producto: {productId}</Text>
              <Text>Cantidad: {quantity}</Text>
            </>
          )}
        </Container>
      </Body>
    </Html>
  );
}
