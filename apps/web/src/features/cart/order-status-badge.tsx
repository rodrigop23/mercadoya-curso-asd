import { Ban, CheckCircle2, CircleAlert, Clock, Hourglass } from 'lucide-react';
import { Badge } from '@mercadoya/ui/components/badge';
import type { OrderStatus } from '@/lib/orders';

const statuses = {
  pending: { label: 'Pendiente', icon: Clock },
  confirmed: { label: 'Confirmado', icon: CheckCircle2 },
  rejected: { label: 'Rechazado', icon: CircleAlert },
  cancelled: { label: 'Cancelado', icon: Ban },
  expired: { label: 'Vencido', icon: Hourglass },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { label, icon: Icon } = statuses[status];
  return (
    <Badge variant={status}>
      <Icon data-icon="inline-start" />
      {label}
    </Badge>
  );
}
