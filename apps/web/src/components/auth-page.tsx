import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

type AuthPageProps = {
  mode: 'login' | 'register';
};

export function AuthPage({ mode }: AuthPageProps) {
  const isRegister = mode === 'register';
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');

    try {
      const result = isRegister
        ? await authClient.signUp.email({
            name: String(formData.get('name') ?? '').trim(),
            email,
            password,
          })
        : await authClient.signIn.email({ email, password });

      if (result.error) {
        setErrorMessage(result.error.message || 'No se pudo completar la solicitud.');
        return;
      }

      await navigate({ to: '/catalog' });
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo conectar con el servidor. Inténtalo de nuevo.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-[calc(100svh-10rem)] max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_28rem] lg:gap-16">
      <section className="hidden max-w-xl space-y-6 lg:block">
        <h1 className="text-5xl font-semibold leading-[1.08] tracking-tight text-foreground">
          Lo que necesitas, <span className="text-primary">más cerca.</span>
        </h1>
        <p className="max-w-md text-lg leading-8 text-muted-foreground">
          Entra a MercadoYa para descubrir productos de tu comunidad y tener tu mercado a mano.
        </p>
        <p className="text-sm font-semibold text-primary">Mercado local, sin vueltas</p>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 pt-1 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
            Fácil de usar
          </li>
          <li className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
            Hecho para tu barrio
          </li>
        </ul>
      </section>

      <Card className="mx-auto w-full max-w-md border border-border/80 shadow-xl shadow-emerald-950/[0.04]">
        <CardHeader className="gap-2 px-6 pt-7 sm:px-8">
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-primary/10 text-lg font-bold text-primary">
            M
          </span>
          <CardTitle className="text-2xl font-semibold tracking-tight">
            {isRegister ? 'Crea tu cuenta' : 'Qué bueno verte'}
          </CardTitle>
          <CardDescription className="text-sm leading-6">
            {isRegister
              ? 'Regístrate para empezar a explorar MercadoYa.'
              : 'Ingresa con tu correo y contraseña para continuar.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="px-6 pt-2 sm:px-8">
          <form className="space-y-5" onSubmit={handleSubmit}>
            {isRegister && (
              <div className="space-y-2">
                <Label htmlFor="name">Nombre</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="Tu nombre"
                  autoComplete="name"
                  required
                  minLength={1}
                  disabled={isSubmitting}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="nombre@correo.com"
                autoComplete="email"
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="Al menos 8 caracteres"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                required
                minLength={8}
                maxLength={128}
                disabled={isSubmitting}
              />
            </div>

            {errorMessage && (
              <p
                className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
                role="alert"
              >
                {errorMessage}
              </p>
            )}

            <Button type="submit" className="h-10 w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Un momento…' : isRegister ? 'Crear cuenta' : 'Ingresar'}
            </Button>
          </form>
        </CardContent>

        <CardFooter className="justify-center border-t border-border/70 px-6 py-4 text-sm text-muted-foreground sm:px-8">
          {isRegister ? '¿Ya tienes una cuenta?' : '¿Primera vez en MercadoYa?'}{' '}
          <Link
            to={isRegister ? '/login' : '/register'}
            className="ml-1 font-semibold text-primary underline-offset-4 hover:underline"
          >
            {isRegister ? 'Ingresar' : 'Regístrate'}
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}
