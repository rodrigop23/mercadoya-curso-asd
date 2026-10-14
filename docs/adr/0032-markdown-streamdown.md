# ADR 0032: Markdown en las respuestas del asistente con Streamdown

- Fecha: 2026-10-13
- Estado: aceptado
- Rama: `v7-ai-agent`
- Antecedente: [ADR 0031](0031-fitness-functions.md).

## Contexto

El agente produce Markdown, pero el chat mostraba listas, negritas y tablas como
texto con `whitespace-pre-wrap`. El contenido del modelo no es confiable y debe
pasar por un renderer que no permita HTML, imágenes ni protocolos ejecutables.
Los mensajes del comprador conservan su texto literal.

## Decisión

Fijamos `streamdown@2.7.0` en `packages/ui`. Sus peers `react` y `react-dom`
admiten `^18.0.0 || ^19.0.0`, compatibles con React 19.3 del proyecto. No se
cambian Node v24.14.1, pnpm 11.8.0 ni las versiones de React, Vite o Tailwind.

Streamdown incluye GFM y remend para Markdown incompleto, memoiza bloques y
ofrece controles de tablas/código y caret. Con react-markdown habría que
componer esas funciones y mantener el manejo de fragmentos del stream.
`AssistantMarkdown` recibe un string, `streaming` y `className`. El módulo
público carga `markdown-renderer.tsx` con `React.lazy` y `Suspense`; su fallback
es texto escapado por React con las mismas clases de texto plano anteriores.
Los imports de tipos no cargan el renderer. No se añade al scope shared de
Module Federation ni se importa desde el remoto de catálogo.

El renderer usa `mode="streaming"`, `parseIncompleteMarkdown` e
`isAnimating={streaming}`. El caret de bloque aparece solo con `streaming=true`.
El chat pasa ese estado exclusivamente a la última respuesta del asistente
mientras `useStream.isLoading` está activo. Las props de configuración y los
componentes tienen referencias estables a nivel de módulo.

Elegimos código monoespaciado sin colores, opción B. No instalamos
`@streamdown/code`, Shiki, math/KaTeX, Mermaid ni CJK. No usamos `animated` ni
importamos `streamdown/styles.css`. El caret basta y no requiere ese CSS.
No hay CDN, eval ni descarga de gramáticas al renderizar.

Tablas y código tienen una altura máxima de 240 px. El bubble del asistente usa
todo el ancho disponible y las celdas tienen un mínimo de 9 rem para no partir
los nombres en letras. El renderer de tablas mantiene scroll horizontal y
vertical, con scrollbars de los tokens del tema. `controls` habilita solo copiar y
desactiva descarga y fullscreen. `translations` traduce copiar código/tabla,
los formatos Markdown/CSV/TSV y el anuncio de copiado. No reemplazamos los
renderers de tablas o código ni duplicamos sus clases.

Los selectores `data-streamdown` usan los tokens existentes de superficie,
texto, borde y foco, con cyan `#2EC4FF` para enlaces subrayados y caret. No se
introduce coral. Los encabezados grandes se limitan a 1 rem dentro del bubble.
El cyan solicitado tiene poco contraste sobre fondos claros; el subrayado
conserva la identificación del enlace y su foco usa `--ring`.

## Pipeline de seguridad

El pipeline explícito, en orden, convierte imágenes Markdown en su texto
alternativo, aplica `defaultRehypePlugins.sanitize` y aplica la función de
`defaultRehypePlugins.harden` con opciones propias. Omite `raw`; `skipHtml`
también está activo. No se permite interpretar HTML del modelo.

Harden recibe `allowedProtocols: ['http', 'https']`,
`allowedLinkPrefixes: ['*']`, `allowedImagePrefixes: []`,
`allowDataImages: false` y `linkBlockPolicy: 'text-only'`. El wildcard permite
dominios externos, sujeto a la restricción de protocolos. `urlTransform` y el
override de enlaces validan además URLs absolutas con `http://` o `https://`
y `new URL`; rechazan relativas, fragmentos y protocol-relative. No se usa un
`defaultOrigin` que pueda convertir URLs rechazadas en enlaces del host.

El override compone `defaultComponents.a`, fija `target="_blank"` y
`rel="noopener noreferrer nofollow"`, y convierte URLs inválidas en texto.
El modal queda desactivado con `linkSafety: { enabled: false }`. Esta política
restringe el formato de URL; no es una lista de sitios confiables ni una
protección contra phishing en un destino http(s).

`disallowedElements: ['img']` y `unwrapDisallowed` son defensas adicionales.
Las imágenes Markdown se convierten antes en texto, por lo que ni siquiera
pueden iniciar una petición de red. `remend: { linkMode: 'text-only' }` evita
crear enlaces clicables a partir de destinos incompletos.

## Diferencias verificadas con la documentación

Se abrieron las páginas enumeradas abajo antes de implementar y se contrastaron
con los tipos y el código instalado de Streamdown 2.7.0 y rehype-harden 1.1.8.

- Getting started presenta un monorepo con dependencia hoisted al root. Aquí
  pnpm enlaza Streamdown en `packages/ui/node_modules/streamdown`, hacia
  `node_modules/.pnpm/streamdown@2.7.0_…/node_modules/streamdown`. No existe un
  enlace en el root. Desde `apps/web/src/styles.css` la ruta correcta es
  `../../../packages/ui/node_modules/streamdown/dist/*.js`. Tailwind v4 usa ese
  `@source`, además del source del catálogo ya existente.
- Configuración documenta que `unwrapDisallowed` conserva el alt de imágenes.
  En 2.7.0, `img` no tiene hijos y se elimina sin conservar `alt`. Nuestro
  transformer previo convierte ese atributo en un nodo de texto seguro.
- Componentes enumera `strong`, pero el renderer predeterminado usa un `span`
  con `data-streamdown="strong"`. Lo envolvemos en `strong`, conservando el
  renderer, sus estilos y el atributo. No se duplican clases internas.
- Seguridad expone las claves `raw`, `sanitize` y `harden`. `harden` es una
  tupla `[plugin, opciones]`; se reutiliza su función con opciones nuevas.
  La declaración pública es `Record<string, Pluggable>` y pierde el tipo de
  tupla; la extracción requiere una aserción local al tipo de plugin.
- Rehype-harden exige `defaultOrigin` al configurar prefijos concretos de
  enlaces o imágenes. Se usa wildcard para dominios, junto con protocolos
  restringidos y validación adicional de URLs, sin origen de reemplazo.
- remend repara `**hola` y fences sin cerrar. Una cabecera GFM antes de su fila
  separadora todavía es texto. Mientras llega el stream se retiene ese último
  fragmento hasta recibir la fila, evitando mostrar pipes sueltos. No se
  modifica el mensaje guardado.
- Link safety coincide con la API instalada. Se desactiva según la decisión
  por defecto. `onLinkCheck` no es necesario. Carets usa `--streamdown-caret`
  y un pseudoelemento, sin animación por palabra. Código sin plugin respeta
  `codeBlockMaxHeight` y conserva copiar. GFM respeta `tableMaxHeight`.
- Internacionalización y memoización coinciden para las opciones utilizadas.
  AI Elements redirige a `elements.ai-sdk.dev`; solo se consultó como referencia.
  El lector web falló al abrir `llms.txt`; se leyó directamente con curl.
  React.lazy y Tailwind v4 coinciden con el comportamiento usado.

## Bundle y coste

Builds locales de Vite en la misma rama, antes y después del cambio. Cifras en
kB decimales del reporte `pnpm --filter @mercadoya/web build`.

- Chunk principal `index-*.js`: 618,17 kB / 176,05 kB gzip antes; 618,74 kB /
  176,24 kB gzip después. Incremento de 0,57 kB y 0,19 kB gzip.
- CSS del host: 100,07 kB / 17,11 kB gzip antes; 111,27 kB / 18,85 kB gzip
  después. Incremento de 11,20 kB y 1,74 kB gzip por las clases de Streamdown
  y los ajustes de tokens. El CSS sigue cargándose inicialmente.
- Nuevo chunk diferido `markdown-renderer-*.js`: 501,46 kB / 154,39 kB gzip.
  Streamdown es costoso al abrir la primera respuesta, aunque no afecta el
  JavaScript inicial. Vite mantiene su advertencia para chunks >500 kB, sin
  subir el umbral.
- El build emite además stubs internos diferidos `mermaid-*.js` de 0,07 kB /
  0,08 kB gzip y `highlighted-body-*.js` de 0,69 kB / 0,44 kB gzip. No contienen
  los plugins opcionales. El build del remoto pasa y no contiene Streamdown
  ni remend.

## Agente y validación

El prompt común pide nombres de productos en negrita, recomendaciones con
viñetas y tabla al comparar dos o más productos, sin HTML, imágenes ni enlaces
inventados. Compras y postventa heredan esa instrucción.

No se modificó `output_guard` ni su normalización. Su expresión de importes
ya reconoce `**S/ 129**`, celdas de tablas y viñetas. Los tests prueban evidencia
válida, ausencia de evidencia, evidencia de otro precio y redacción de correo
en los tres formatos, conservando la regla original.

El backend existente publica la respuesta completa después de la guarda, sin
exponer tokens sin validar. El componente admite fragmentos de streaming y el
caret se verifica con estados controlados; este cambio no habilita streaming
previo a `output_guard`.

Verificaciones automatizadas:

- `pnpm -r typecheck`, `pnpm -r test`, builds de web y catálogo, lint de UI/web.
- 100 tests web, incluidos listas, tabla, código, strong, fragmentos incompletos,
  caret, fallback, usuario literal, URLs peligrosas, HTML e imágenes.
- 397 tests del agente, Ruff y ambos smokes, normal y `--tools`.
- Evals offline: 38 casos generales y 8 capabilities, scores 1,0 en los
  evaluadores aplicables, sin errores ni reducción de umbrales.
- `pnpm deps:check` con cero errores y las dos advertencias circulares previas;
  siete tests de límites de arquitectura; Trivy con cero hallazgos.

La revisión en navegador usó `pnpm demo:agent` y un comprador sintético local.
La pregunta sobre Sonix Air y Sonix Pro produjo una tabla con los precios
confirmados S/ 129 y S/ 349. "Busco audífonos" produjo viñetas y nombres en
negrita. Se revisaron claro a 1280 px y oscuro a 390 px, con scroll horizontal
de tabla y sin desborde de página. El componente real recibió un fragmento
`**hola`: mostró `hola` en negrita y caret cyan, que desapareció al finalizar.
El código tuvo altura máxima de 240 px y el enlace usó rgb(46, 196, 255).
No hubo recursos de navegador fuera de los orígenes localhost del stack.

La petición de script y enlace javascript quedó como texto literal del usuario;
el agente respondió con su rechazo de dominio y no hubo elementos ni enlaces
peligrosos. Los tests DOM cubren además contenido malicioso recibido como
respuesta del asistente. La tarjeta real de agregar al carrito pidió aprobación
y aumentó el contador en una unidad al aprobar. El smoke `--tools` cubre
también rechazos, cancelación aprobada, JWT nuevo al reanudar y segundo resume.

## Fuentes consultadas

- [Getting started](https://streamdown.ai/docs/getting-started).
- [Configuración](https://streamdown.ai/docs/configuration).
- [Componentes](https://streamdown.ai/docs/components).
- [Seguridad](https://streamdown.ai/docs/security).
- [Link safety](https://streamdown.ai/docs/link-safety).
- [Code blocks](https://streamdown.ai/docs/code-blocks).
- [Plugin code](https://streamdown.ai/docs/plugins/code).
- [GFM](https://streamdown.ai/docs/gfm).
- [Carets](https://streamdown.ai/docs/carets).
- [Animación](https://streamdown.ai/docs/animation).
- [Internacionalización](https://streamdown.ai/docs/internationalization).
- [Memoización](https://streamdown.ai/docs/memoization).
- [Índice completo](https://streamdown.ai/llms.txt).
- [AI Elements](https://ai-sdk.dev/elements).
- [Tailwind v4, detección de clases](https://tailwindcss.com/docs/detecting-classes-in-source-files).
- [React.lazy](https://react.dev/reference/react/lazy).
