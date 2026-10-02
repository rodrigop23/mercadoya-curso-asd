import type { ComponentProps } from 'react';

import { Button } from '@mercadoya/ui/components/button';
import { Spinner } from '@mercadoya/ui/components/spinner';
import { useFormContext } from '@/hooks/form-context';

type SubmitButtonProps = Omit<ComponentProps<typeof Button>, 'type'> & {
  pendingLabel: string;
};

export function SubmitButton({ children, disabled, pendingLabel, ...props }: SubmitButtonProps) {
  const form = useFormContext();

  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button {...props} type="submit" disabled={disabled || isSubmitting}>
          {isSubmitting ? (
            <>
              <Spinner data-icon="inline-start" aria-hidden="true" />
              {pendingLabel}
            </>
          ) : (
            children
          )}
        </Button>
      )}
    </form.Subscribe>
  );
}
