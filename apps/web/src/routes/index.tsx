import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  return (
    <main>
      <h1>MercadoYa</h1>
      <p>React, Vite y TanStack Router están listos.</p>
    </main>
  );
}
