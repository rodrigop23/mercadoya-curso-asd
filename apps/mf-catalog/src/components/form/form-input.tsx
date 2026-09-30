import type { ComponentProps, ReactNode } from 'react';

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useFieldContext } from '@/hooks/form-context';

type FormInputProps = Omit<
  ComponentProps<typeof Input>,
  'name' | 'value' | 'defaultValue' | 'onChange' | 'onBlur'
> & {
  label: string;
  description?: ReactNode;
};

export function FormInput({ label, description, id, type, ...props }: FormInputProps) {
  const field = useFieldContext<string | File | null>();
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const inputId = id ?? field.name;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const describedBy =
    [props['aria-describedby'], descriptionId].filter(Boolean).join(' ') || undefined;

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Input
        {...props}
        id={inputId}
        name={field.name}
        type={type}
        value={
          type === 'file' || typeof field.state.value !== 'string' ? undefined : field.state.value
        }
        onBlur={field.handleBlur}
        onChange={(event) =>
          field.handleChange(
            type === 'file' ? (event.target.files?.[0] ?? null) : event.target.value,
          )
        }
        aria-invalid={isInvalid}
        aria-describedby={describedBy}
      />
      {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  );
}
