import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImagePlus } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createProduct, productsQueryOptions } from '@/lib/products';

export function AdminProductForm() {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [created, setCreated] = useState(false);
  const createProductMutation = useMutation({
    mutationFn: createProduct,
    onSuccess: async () => {
      setCreated(true);
      formRef.current?.reset();
      await queryClient.invalidateQueries({ queryKey: productsQueryOptions.queryKey });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreated(false);
    createProductMutation.mutate(new FormData(event.currentTarget));
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
          Administración
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Productos</h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Publica un producto para que aparezca en el catálogo de MercadoYa.
        </p>
      </div>

      <Card className="mt-8 max-w-3xl shadow-sm">
        <CardContent className="p-6 sm:p-8">
          <form ref={formRef} className="space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="title">Título</Label>
              <Input
                id="title"
                name="title"
                required
                maxLength={160}
                placeholder="Ej. Palta hass"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descripción</Label>
              <Textarea
                id="description"
                name="description"
                required
                maxLength={5000}
                rows={4}
                placeholder="Describe el producto, su origen o presentación."
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="price">Precio (S/)</Label>
                <Input
                  id="price"
                  name="price"
                  type="number"
                  min="0.01"
                  max="99999999.99"
                  step="0.01"
                  required
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stock">Stock disponible</Label>
                <Input
                  id="stock"
                  name="stock"
                  type="number"
                  min="0"
                  max="2147483647"
                  step="1"
                  defaultValue="0"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="image">Imagen</Label>
              <Input
                id="image"
                name="image"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                required
              />
              <p className="text-xs text-muted-foreground">JPG, PNG o WebP. Tamaño máximo: 5 MB.</p>
            </div>

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

            <Button type="submit" disabled={createProductMutation.isPending}>
              <ImagePlus data-icon="inline-start" />
              {createProductMutation.isPending ? 'Publicando…' : 'Crear producto'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
