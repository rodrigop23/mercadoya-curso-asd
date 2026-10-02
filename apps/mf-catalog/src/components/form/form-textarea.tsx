import type { ComponentProps, ReactNode } from 'react';

import { Field, FieldDescription, FieldError, FieldLabel } from '@mercadoya/ui/components/field';
import { Textarea } from '@mercadoya/ui/components/textarea';
import { useFieldContext } from '@/hooks/form-context';

type FormTextareaProps = Omit<
  ComponentProps<typeof Textarea>,
  'name' | 'value' | 'defaultValue' | 'onChange' | 'onBlur'
> & {
  label: string;
  description?: ReactNode;
};

export function FormTextarea({ label, description, id, ...props }: FormTextareaProps) {
  const field = useFieldContext<string>();
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const inputId = id ?? field.name;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const describedBy =
    [props['aria-describedby'], descriptionId].filter(Boolean).join(' ') || undefined;

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Textarea
        {...props}
        id={inputId}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={isInvalid}
        aria-describedby={describedBy}
      />
      {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  );
}
