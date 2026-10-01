import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { Button } from '@mercadoya/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@mercadoya/ui/components/dialog';
import { FieldGroup } from '@mercadoya/ui/components/field';
import { useAppForm } from '@/hooks/use-app-form';
import type { Product } from '@/lib/products';
import { useCatalogApi } from '@/catalog-slice';

const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function productSchema(requiresImage: boolean) {
  return z.object({
    title: z.string().trim().min(1, 'El título es obligatorio.').max(160),
    description: z.string().trim().min(1, 'La descripción es obligatoria.').max(5000),
    price: z
      .string()
      .regex(/^\d+(?:\.\d{1,2})?$/, 'El precio debe tener hasta dos decimales.')
      .refine((value) => Number(value) >= 2 && Number(value) <= 999_999.99, {
        message: 'El precio debe estar entre S/ 2.00 y S/ 999,999.99.',
      }),
    stock: z
      .string()
      .regex(/^\d+$/, 'El stock debe ser un número entero no negativo.')
      .refine((value) => Number(value) <= 2_147_483_647, {
        message: 'El stock no puede superar 2,147,483,647.',
      }),
    image: z
      .instanceof(File)
      .nullable()
      .refine((file) => !requiresImage || file !== null, {
        message: 'Debes seleccionar una imagen.',
      })
      .refine((file) => !file || IMAGE_TYPES.includes(file.type), {
        message: 'La imagen debe ser JPG, PNG o WebP.',
      })
      .refine((file) => !file || (file.size > 0 && file.size <= MAX_IMAGE_SIZE), {
        message: 'La imagen debe pesar entre 1 byte y 2 MB.',
      }),
  });
}

export function AdminProductForm({
  product,
  open,
  onClose,
  onClosed,
}: {
  product: Product | null;
  open: boolean;
  onClose: () => void;
  onClosed: () => void;
}) {
  const { createProduct, productsQueryOptions, updateProduct } = useCatalogApi();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (formData: FormData) =>
      product ? updateProduct({ id: product.id, formData }) : createProduct(formData),
  });
  const form = useAppForm({
    defaultValues: {
      title: product?.title ?? '',
      description: product?.description ?? '',
      price: product ? String(product.price) : '',
      stock: product ? String(product.stock) : '0',
      image: null as File | null,
    },
    validators: { onSubmit: productSchema(!product) },
    onSubmit: async ({ value }) => {
      const formData = new FormData();
      formData.set('title', value.title.trim());
      formData.set('description', value.description.trim());
      formData.set('price', value.price);
      formData.set('stock', value.stock);
      if (value.image) formData.set('image', value.image);

      try {
        await mutation.mutateAsync(formData);
        await queryClient.invalidateQueries({ queryKey: productsQueryOptions.queryKey });
        onClose();
      } catch {
        // El error de la mutación se muestra junto al botón de guardado.
      }
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) onClosed();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(90svh,48rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <form.AppForm>
          <form
            className="flex min-h-0 flex-1 flex-col"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <DialogHeader className="sticky top-0 shrink-0 border-b bg-popover px-6 py-5">
              <DialogTitle>{product ? 'Editar producto' : 'Crear producto'}</DialogTitle>
              <DialogDescription>
                {product
                  ? 'Actualiza los datos del producto. Deja la imagen vacía para conservar la actual.'
                  : 'Completa los datos para publicar el producto en el catálogo.'}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <FieldGroup>
                <form.AppField name="title">
                  {(field) => (
                    <field.FormInput
                      label="Título"
                      required
                      maxLength={160}
                      placeholder="Ej. Palta hass"
                    />
                  )}
                </form.AppField>
                <form.AppField name="description">
                  {(field) => (
                    <field.FormTextarea
                      label="Descripción"
                      required
                      maxLength={5000}
                      rows={4}
                      placeholder="Describe el producto, su origen o presentación."
                    />
                  )}
                </form.AppField>
                <FieldGroup className="sm:grid sm:grid-cols-2">
                  <form.AppField name="price">
                    {(field) => (
                      <field.FormInput
                        label="Precio (S/)"
                        type="number"
                        min="2"
                        max="999999.99"
                        step="0.01"
                        required
                        placeholder="0.00"
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="stock">
                    {(field) => (
                      <field.FormInput
                        label="Stock disponible"
                        type="number"
                        min="0"
                        max="2147483647"
                        step="1"
                        required
                      />
                    )}
                  </form.AppField>
                </FieldGroup>
                <form.AppField name="image">
                  {(field) => (
                    <field.FormInput
                      label="Imagen"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      required={!product}
                      description={
                        product
                          ? 'Opcional. JPG, PNG o WebP, hasta 2 MB. Si no eliges una imagen, se conserva la actual.'
                          : 'JPG, PNG o WebP. Tamaño máximo: 2 MB.'
                      }
                    />
                  )}
                </form.AppField>
                {mutation.error && (
                  <p className="text-sm text-destructive" role="alert">
                    {mutation.error.message}
                  </p>
                )}
              </FieldGroup>
            </div>
            <DialogFooter className="sticky bottom-0 mx-0 mb-0 shrink-0 rounded-none bg-popover px-6 py-4">
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={onClose}
              >
                Cancelar
              </Button>
              <form.SubmitButton pendingLabel={product ? 'Guardando…' : 'Publicando…'}>
                {product ? 'Guardar cambios' : 'Crear producto'}
              </form.SubmitButton>
            </DialogFooter>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
