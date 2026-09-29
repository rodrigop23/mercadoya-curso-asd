import { createFormHook } from '@tanstack/react-form';

import { FormInput } from '@/components/form/form-input';
import { FormTextarea } from '@/components/form/form-textarea';
import { SubmitButton } from '@/components/form/submit-button';
import { fieldContext, formContext } from '@/hooks/form-context';

export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { FormInput, FormTextarea },
  formComponents: { SubmitButton },
});
