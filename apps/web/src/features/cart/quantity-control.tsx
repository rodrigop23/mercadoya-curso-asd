import { Minus, Plus, Trash2 } from 'lucide-react';
import { Button } from '@mercadoya/ui/components/button';
import { cn } from '@mercadoya/ui/lib/utils';

export function QuantityControl({
  quantity,
  title,
  onDecrease,
  onIncrease,
  decreaseDisabled,
  increaseDisabled,
  disabled,
  className,
}: {
  quantity: number;
  title: string;
  onDecrease(): void;
  onIncrease(): void;
  decreaseDisabled?: boolean;
  increaseDisabled?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={`Cantidad de ${title}`}
      className={cn(
        'flex h-9 items-center justify-between gap-1 rounded-lg border border-border bg-card px-0.5',
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="rounded-md"
        disabled={disabled || decreaseDisabled}
        aria-label={
          quantity === 1 ? `Eliminar ${title} del carrito` : `Restar una unidad de ${title}`
        }
        onClick={onDecrease}
      >
        {quantity === 1 ? <Trash2 data-icon="inline-start" /> : <Minus data-icon="inline-start" />}
      </Button>
      <span
        className="min-w-8 text-center text-sm font-medium tabular-nums"
        aria-live="polite"
        aria-atomic="true"
      >
        {quantity}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="rounded-md"
        disabled={disabled || increaseDisabled}
        aria-label={`Agregar una unidad de ${title}`}
        onClick={onIncrease}
      >
        <Plus data-icon="inline-start" />
      </Button>
    </div>
  );
}
