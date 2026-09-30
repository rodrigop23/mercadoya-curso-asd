# UI compartida de MercadoYa

`@mercadoya/ui` contiene los componentes ShadCN usados por `apps/web` y
`apps/mf-catalog`. pnpm lo incluye mediante `packages/*`; los consumidores declaran
`@mercadoya/ui: workspace:*`. Vite 8 compila directamente los exports TypeScript,
sin un build intermedio de la librería. React y React DOM son peer dependencies;
las aplicaciones proporcionan la misma versión 19.3.0.

## Uso y API pública

```tsx
import { Button, buttonVariants } from '@mercadoya/ui/components/button';
import { Card, CardContent } from '@mercadoya/ui/components/card';
import { cn } from '@mercadoya/ui/lib/utils';
```

Cada aplicación importa una vez el CSS desde su hoja de entrada:

```css
@import '@mercadoya/ui/globals.css';
```

Los exports públicos son:

| Import                                   | Contenido                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `@mercadoya/ui/components/button`        | `Button`, `buttonVariants`                                                                       |
| `@mercadoya/ui/components/card`          | `Card` y sus partes de encabezado, título, descripción, acción, contenido y pie                  |
| `@mercadoya/ui/components/input`         | `Input`                                                                                          |
| `@mercadoya/ui/components/textarea`      | `Textarea`                                                                                       |
| `@mercadoya/ui/components/field`         | `Field` y sus partes de agrupación, leyenda, etiqueta, contenido, descripción, separador y error |
| `@mercadoya/ui/components/label`         | `Label`                                                                                          |
| `@mercadoya/ui/components/separator`     | `Separator`                                                                                      |
| `@mercadoya/ui/components/spinner`       | `Spinner`                                                                                        |
| `@mercadoya/ui/components/dialog`        | `Dialog` y sus partes                                                                            |
| `@mercadoya/ui/components/alert-dialog`  | `AlertDialog` y sus partes                                                                       |
| `@mercadoya/ui/components/avatar`        | `Avatar` y sus partes                                                                            |
| `@mercadoya/ui/components/dropdown-menu` | `DropdownMenu` y sus partes                                                                      |
| `@mercadoya/ui/lib/utils`                | `cn`, reexport de la dependencia existente `cn`                                                  |
| `@mercadoya/ui/globals.css`              | Tailwind v4, animaciones, fuente Geist, tokens y tema oscuro                                     |

Los módulos conservan los exports y props de las copias existentes. Consulta sus
exports nombrados en [src/components](src/components) y la
[documentación Base UI de ShadCN](https://ui.shadcn.com/docs/components/base/button)
para componer las partes. No hay un import raíz ni default exports. Los patrones
`components/*`, `lib/*` y `hooks/*` permiten que la CLI añada archivos; actualmente
no hay hooks compartidos. Documenta los nuevos módulos públicos al añadirlos.

## Añadir componentes

La CLI verificada el 30 de septiembre de 2026 es ShadCN **4.21.0**, también resuelta
por `shadcn@latest` en esa fecha. Desde la raíz, inspecciona primero:

```sh
pnpm dlx shadcn@latest info --cwd packages/ui --json
pnpm dlx shadcn@latest docs button --cwd packages/ui
pnpm dlx shadcn@latest add button --cwd packages/ui --dry-run
pnpm dlx shadcn@latest add button --cwd packages/ui --diff
```

`button` ya existe. Sustituye su nombre por el componente de `@shadcn` que necesites
y ejecuta `add` sin `--dry-run` para incorporarlo. Para reproducir exactamente la
CLI verificada puedes usar `pnpm dlx shadcn@4.21.0`.

También puedes ejecutar la CLI desde un consumidor:

```sh
pnpm dlx shadcn@latest add button --cwd apps/web --dry-run
pnpm dlx shadcn@latest add button --cwd apps/mf-catalog --dry-run
```

Sus aliases `ui` y `utils` dirigen los componentes y utilidades al paquete. Los
aliases locales `components`, `lib` y `hooks` de las apps conservan las composiciones
específicas en cada app. Revisa archivos, dependencias y CSS antes de aplicar;
no uses `--overwrite` para una actualización sin revisar el diff.

Los tres `components.json` mantienen `style: base-nova`, `baseColor: neutral`,
`iconLibrary: lucide`, `rsc: false` y `tailwind.config: ""`. Todos apuntan al mismo
CSS, `packages/ui/src/styles/globals.css`. Los imports públicos resuelven mediante
`package.json#exports`, sin aliases Vite adicionales para la librería.

## CSS y límites

Los tokens claros, `.dark`, la tipografía y estilos base se migraron sin cambios.
`@source '../components'`, relativo al CSS compartido, registra las clases del
paquete en Tailwind v4. Cada app detecta además sus propias clases y genera su CSS
con `@tailwindcss/vite`. Los temas se aplican en cada documento, incluido el documento
del catálogo cuando se monta en iframe.

Base UI, CVA, `cn`, fuente y CSS de ShadCN/animaciones pertenecen al paquete.
Los consumidores conservan React, React DOM, Lucide y Tailwind porque también los
usan directamente o mediante el plugin Vite; el lockfile resuelve las mismas versiones.
La librería no importa APIs de dominio, autenticación, router ni código del iframe.
Las composiciones TanStack Form siguen en las apps. La composición host + catálogo
por iframe continúa; no se introduce Module Federation, otro MF ni Storybook.

## Verificación y CI

```sh
pnpm exec turbo run typecheck lint build --filter=@mercadoya/ui --filter=@mercadoya/web --filter=@mercadoya/mf-catalog
```

La CI existente ejecuta `pnpm typecheck`, `pnpm lint` y `pnpm build` sobre todos los
workspaces. Incluye los scripts `typecheck` y `lint` de UI y los builds Vite de ambos
consumidores. UI no emite `dist`; sus fuentes se compilan dentro de cada consumidor.
Turbo propaga los cambios de dependencias mediante `^build`, `^typecheck` y `^lint`
para invalidar los resultados de los consumidores cuando cambia UI.

## Documentación oficial verificada

- [ShadCN en monorepos](https://ui.shadcn.com/docs/monorepo).
- [CLI de ShadCN](https://ui.shadcn.com/docs/cli).
- [Tailwind v4 y detección de fuentes](https://tailwindcss.com/docs/detecting-classes-in-source-files).
- [Vite y paquetes enlazados en monorepos](https://vite.dev/guide/dep-pre-bundling.html#monorepos-and-linked-dependencies).
- [Vite y CSS](https://vite.dev/guide/features.html#css).
