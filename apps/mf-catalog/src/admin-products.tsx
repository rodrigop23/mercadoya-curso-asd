import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, PackageOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AdminProductForm } from '@/features/catalog/admin-product-form';
import { deleteProduct, productImageUrl, productsQueryOptions, type Product } from '@/lib/products';

const priceFormatter = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });

export function AdminProductsContent() {
  const { data: products, isPending, error } = useQuery(productsQueryOptions);
  const [editor, setEditor] = useState<{ product: Product | null; key: string } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({ mutationFn: deleteProduct });

  async function confirmDelete() {
    if (!productToDelete) return;
    try {
      await deleteMutation.mutateAsync(productToDelete.id);
      setDeleteDialogOpen(false);
    } catch {
      // El diálogo conserva el error para poder reintentar.
    }
  }

  if (isPending) return <main className="mx-auto max-w-6xl px-4 py-12">Cargando productos…</main>;
  if (error || !products) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-12" role="alert">
        {error?.message ?? 'No se pudo cargar el catálogo.'}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Administración de productos
          </h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            Crea y administra los productos disponibles en el catálogo de MercadoYa.
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => {
            setEditor({ product: null, key: 'new' });
            setEditorOpen(true);
          }}
        >
          <Plus data-icon="inline-start" />
          Crear producto
        </Button>
      </header>

      {products.length === 0 ? (
        <Card className="mt-8 max-w-2xl border-dashed border-border bg-card/70 shadow-none">
          <CardContent className="flex items-center gap-5 p-6 sm:p-8">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <PackageOpen className="size-6" />
            </span>
            <div>
              <h2 className="font-semibold">Todavía no hay productos</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Crea el primero para que aparezca en el catálogo.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <li key={product.id}>
              <Card className="h-full shadow-sm">
                <img
                  src={productImageUrl(product.imagePath)}
                  alt={product.title}
                  className="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                />
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <h2 className="text-lg font-semibold leading-snug">{product.title}</h2>
                    <p className="shrink-0 font-semibold text-primary">
                      {priceFormatter.format(product.price)}
                    </p>
                  </div>
                  <p className="line-clamp-2 flex-1 [overflow-wrap:anywhere] text-sm leading-6 text-muted-foreground">
                    {product.description}
                  </p>
                  <p className="text-xs font-medium text-muted-foreground">
                    {product.stock > 0
                      ? `${product.stock} unidades disponibles`
                      : 'Sin stock por ahora'}
                  </p>
                  <div className="flex gap-2 border-t border-border pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        setEditor({ product, key: product.id });
                        setEditorOpen(true);
                      }}
                    >
                      <Pencil data-icon="inline-start" />
                      Editar
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      className="flex-1"
                      onClick={() => {
                        deleteMutation.reset();
                        setProductToDelete(product);
                        setDeleteDialogOpen(true);
                      }}
                    >
                      <Trash2 data-icon="inline-start" />
                      Eliminar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {editor && (
        <AdminProductForm
          key={editor.key}
          product={editor.product}
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          onClosed={() => setEditor(null)}
        />
      )}

      {productToDelete && (
        <AlertDialog
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            if (!open && !deleteMutation.isPending) setDeleteDialogOpen(false);
          }}
          onOpenChangeComplete={(open) => {
            if (!open) {
              setProductToDelete(null);
              if (deleteMutation.isSuccess) {
                void queryClient.invalidateQueries({ queryKey: productsQueryOptions.queryKey });
              }
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Eliminar producto</AlertDialogTitle>
              <AlertDialogDescription>
                ¿Eliminar "{productToDelete?.title}"? El producto dejará de aparecer en el catálogo.
                Esta acción no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deleteMutation.error && (
              <p className="text-sm text-destructive" role="alert">
                {deleteMutation.error.message}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => void confirmDelete()}
              >
                {deleteMutation.isPending && (
                  <LoaderCircle
                    data-icon="inline-start"
                    className="animate-spin motion-reduce:animate-none"
                  />
                )}
                {deleteMutation.isPending ? 'Eliminando…' : 'Eliminar producto'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </main>
  );
}
