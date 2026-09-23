import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, ShoppingBasket, Store, Truck } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
      <section className="relative overflow-hidden rounded-[2rem] bg-emerald-950 px-6 py-12 text-white sm:px-12 sm:py-16 lg:px-16">
        <div className="absolute -right-20 -top-28 size-80 rounded-full bg-emerald-700/40 blur-3xl" />
        <div className="absolute -bottom-40 right-1/3 size-72 rounded-full bg-lime-400/10 blur-3xl" />
        <div className="relative max-w-2xl space-y-7">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-xs font-medium tracking-wide text-emerald-100 sm:text-sm">
            <span className="size-1.5 rounded-full bg-lime-300" />
            Tu mercado de todos los días
          </p>
          <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
            Encuentra lo bueno de tu <span className="text-lime-300">barrio.</span>
          </h1>
          <p className="max-w-xl text-base leading-7 text-emerald-100/80 sm:text-lg">
            Explora productos de tiendas cercanas y apoya a los negocios de tu comunidad.
          </p>
          <Link
            to="/catalog"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-lime-300 px-5 text-sm font-semibold text-emerald-950 transition-colors hover:bg-lime-200"
          >
            Explorar catálogo <ArrowRight className="size-4" />
          </Link>
        </div>
        <div className="relative mt-12 grid max-w-2xl grid-cols-2 gap-3 sm:mt-14 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.08] p-4 backdrop-blur">
            <ShoppingBasket className="mb-3 size-5 text-lime-300" />
            <p className="text-sm font-semibold">Productos locales</p>
            <p className="mt-1 text-xs text-emerald-100/60">Descubre cerca de ti</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.08] p-4 backdrop-blur">
            <Store className="mb-3 size-5 text-lime-300" />
            <p className="text-sm font-semibold">Tiendas de confianza</p>
            <p className="mt-1 text-xs text-emerald-100/60">Apoya tu comunidad</p>
          </div>
          <div className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.08] p-4 backdrop-blur sm:col-span-1">
            <Truck className="mb-3 size-5 text-lime-300" />
            <p className="text-sm font-semibold">Compra sencilla</p>
            <p className="mt-1 text-xs text-emerald-100/60">Lo que buscas, más cerca</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 py-10 sm:grid-cols-2">
        <Card className="border-border/70 shadow-sm">
          <CardContent className="flex items-start gap-4 p-5 sm:p-6">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-primary">
              <ShoppingBasket className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold tracking-tight">Compra con calma</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Revisa nuestro catálogo y encuentra algo rico para hoy.
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-sm">
          <CardContent className="flex items-start gap-4 p-5 sm:p-6">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-primary">
              <Store className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold tracking-tight">Vende en MercadoYa</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Dale más visibilidad a los productos de tu negocio local.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
