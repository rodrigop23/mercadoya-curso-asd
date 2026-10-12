export const rejectionReasons: Record<string, string> = {
  order_cancelled:
    'Cancelaste el pedido. Estamos devolviendo las unidades al stock. Puedes volver a comprar con tu carrito.',
  order_expired:
    'El plazo para pagar terminó. Estamos devolviendo las unidades al stock. Puedes volver a comprar con tu carrito.',
  invalid_quantity: 'La cantidad solicitada no es válida.',
  product_not_found: 'El producto ya no está disponible.',
  insufficient_stock: 'No hay stock suficiente para completar el pedido.',
  stock_limit: 'La reserva supera el límite de stock del producto.',
  polar_checkout_expired: 'El plazo para pagar terminó. Estamos devolviendo las unidades al stock.',
  polar_checkout_failed: 'El pago no se completó. Estamos devolviendo las unidades al stock.',
  polar_order_void: 'El pago fue anulado. Estamos devolviendo las unidades al stock.',
  polar_product_unconfigured: 'El pago de este producto aún no está disponible.',
  polar_checkout_rejected: 'No se pudo preparar el pago de este pedido.',
  polar_amount_invalid: 'El importe del pedido supera el límite de pago.',
};
