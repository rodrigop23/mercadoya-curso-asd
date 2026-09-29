import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImagePlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { z } from 'zod';

import { Card, CardContent } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { useAppForm } from '@/hooks/use-app-form';
import { createProduct, productsQueryOptions } from '@/lib/products';

const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const productSchema = z.object({
  title: z.string().trim().min(1, 'El título es obligatorio.').max(160),
  description: z.string().trim().min(1, 'La descripción es obligatoria.').max(5000),
  price: z
    .string()
    .regex(/^\d+(?:\.\d{1,2})?$/, 'El precio debe tener hasta dos decimales.')
    .refine((value) => Number(value) >= 0.01 && Number(value) <= 99_999_999.99, {
      message: 'El precio debe estar entre S/ 0.01 y S/ 99,999,999.99.',
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
    .refine((file) => file !== null, { message: 'Debes seleccionar una imagen.' })
    .refine((file) => !file || IMAGE_TYPES.includes(file.type), {
      message: 'La imagen debe ser JPG, PNG o WebP.',
    })
    .refine((file) => !file || (file.size > 0 && file.size <= MAX_IMAGE_SIZE), {
      message: 'La imagen debe pesar entre 1 byte y 2 MB.',
    }),
});

export function AdminProductForm() {
  const queryClient = useQueryClient();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [created, setCreated] = useState(false);
  const createProductMutation = useMutation({ mutationFn: createProduct });

  const form = useAppForm({
    defaultValues: {
      title: '',
      description: '',
      price: '',
      stock: '0',
      image: null as File | null,
    },
    validators: { onSubmit: productSchema },
    onSubmit: async ({ value }) => {
      if (!value.image) return;

      setCreated(false);
      const formData = new FormData();
      formData.set('title', value.title);
      formData.set('description', value.description);
      formData.set('price', value.price);
      formData.set('stock', value.stock);
      formData.set('image', value.image);

      try {
        await createProductMutation.mutateAsync(formData);
      } catch {
        return;
      }

      form.reset();
      if (imageInputRef.current) imageInputRef.current.value = '';
      setCreated(true);
      await queryClient.invalidateQueries({ queryKey: productsQueryOptions.queryKey });
    },
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Administración de productos
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Publica un producto para que aparezca en el catálogo de MercadoYa.
        </p>
      </div>

      <Card className="mt-8 max-w-3xl shadow-sm">
        <CardContent className="p-6 sm:p-8">
          <form.AppForm>
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                setCreated(false);
                void form.handleSubmit();
              }}
            >
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
                        min="0.01"
                        max="99999999.99"
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
                      ref={imageInputRef}
                      label="Imagen"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      required
                      description="JPG, PNG o WebP. Tamaño máximo: 2 MB."
                    />
                  )}
                </form.AppField>

                {createProductMutation.error && (
                  <p className="text-sm text-destructive" role="alert">
                    {createProductMutation.error.message}
                  </p>
                )}
                {created && (
                  <p className="text-sm font-medium text-primary" role="status">
                    Producto creado. Ya está disponible en el catálogo.
                  </p>
                )}

                <form.SubmitButton pendingLabel="Publicando…">
                  <ImagePlus data-icon="inline-start" />
                  Crear producto
                </form.SubmitButton>
              </FieldGroup>
            </form>
          </form.AppForm>
        </CardContent>
      </Card>
    </main>
  );
}
