import { Marker, MarkerContent } from '@mercadoya/ui/components/marker';

export function AgentChatEmptyState() {
  return (
    <Marker variant="default">
      <MarkerContent className="flex flex-col gap-2">
        <p>¿Qué tienes en mente para tu próxima compra?</p>
        <p>
          Puedo consultar productos y tus pedidos, y proponer agregar al carrito o cancelar un
          pedido pendiente. Tú apruebas cada cambio.
        </p>
        <p>
          Puedo recordar preferencias como tu talla o presupuesto; pídeme que las olvide cuando
          quieras
        </p>
      </MarkerContent>
    </Marker>
  );
}
