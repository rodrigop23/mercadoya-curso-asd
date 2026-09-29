import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, ShoppingBasket, Store, Truck } from 'lucide-react';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
      <section className="overflow-hidden rounded-[2rem] bg-emerald-950 px-6 py-10 text-white sm:px-12 sm:py-14 lg:px-16 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center lg:gap-14">
          <div className="max-w-2xl space-y-7">
            <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
              Encuentra lo bueno de tu <span className="text-lime-300">barrio.</span>
            </h1>
            <p className="max-w-xl text-base leading-7 text-emerald-100/90 sm:text-lg">
              Explora productos de tiendas cercanas y apoya a los negocios de tu comunidad.
            </p>
            <p className="text-sm font-semibold text-lime-200">Tu mercado de todos los días</p>
            <Link
              to="/catalog"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-lime-300 px-5 text-sm font-semibold text-emerald-950 transition-colors hover:bg-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-950"
            >
              Explorar catálogo <ArrowRight className="size-4" />
            </Link>
          </div>

          <ul className="grid gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-1 lg:gap-0">
            <li className="flex items-start gap-4 py-3 lg:border-b lg:border-white/15 lg:py-5 lg:first:pt-0">
              <ShoppingBasket className="mt-0.5 size-5 shrink-0 text-lime-300" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold">Productos locales</p>
                <p className="mt-1 text-xs leading-5 text-emerald-100/80">Descubre cerca de ti</p>
              </div>
            </li>
            <li className="flex items-start gap-4 py-3 lg:border-b lg:border-white/15 lg:py-5">
              <Store className="mt-0.5 size-5 shrink-0 text-lime-300" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold">Tiendas de confianza</p>
                <p className="mt-1 text-xs leading-5 text-emerald-100/80">Apoya tu comunidad</p>
              </div>
            </li>
            <li className="flex items-start gap-4 py-3 lg:py-5 lg:last:pb-0">
              <Truck className="mt-0.5 size-5 shrink-0 text-lime-300" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold">Compra sencilla</p>
                <p className="mt-1 text-xs leading-5 text-emerald-100/80">
                  Lo que buscas, más cerca
                </p>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <section className="grid gap-x-10 gap-y-8 border-t border-border/70 py-10 sm:grid-cols-2 lg:gap-x-16">
        <article className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-primary">
            <ShoppingBasket className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold tracking-tight">Compra con calma</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Revisa nuestro catálogo y encuentra algo rico para hoy.
            </p>
          </div>
        </article>
        <article className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-primary">
            <Store className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold tracking-tight">Vende en MercadoYa</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Dale más visibilidad a los productos de tu negocio local.
            </p>
          </div>
        </article>
      </section>
    </main>
  );
}
