# 0026: Acciones con confirmación del comprador

- Estado: aceptado
- Fecha: 2026-10-12

## Contexto

El asistente ya consulta Catalog y los pedidos propios mediante MCP. Agregar al
carrito y cancelar un pedido requieren una decisión explícita del comprador en
cada ocasión. El carrito permanece en localStorage y pertenece a la web. Orders
ya ofrece una cancelación autenticada e idempotente.

El JWT del comprador dura cinco minutos. Una confirmación puede llegar con una
credencial nueva; la identidad y el token del request que reanuda deben usarse en
esa ejecución, sin persistirlos ni enviarlos al modelo.

## Decisión

El modelo recibe cinco herramientas MCP de lectura, seleccionadas por una lista
explícita, y dos herramientas locales de propuesta. `propose_add_to_cart` y
`propose_cancel_order` solo describen entradas: el ruteo las desvía a
`confirm_action`. `cancel_my_order` nunca se enlaza al modelo ni al ToolNode del
bucle ordinario. Una propuesta junto a otra llamada devuelve un ToolMessage por
llamada y no ejecuta herramientas ni interrumpe. Una acción a la vez evita que
una aprobación se aplique a otro cambio o a efectos paralelos no revisados.

El nodo primero consulta `get_product` o `get_my_order`, con la configuración del
run. Valida cantidad, stock, pertenencia y estado pendiente antes de presentar
una tarjeta. Las lecturas se repiten cuando el nodo vuelve a ejecutarse al
reanudar; no tienen efectos de negocio. UUID5 sobre el tool_call_id conserva el
mismo action_id. `interrupt(proposal.model_dump(mode="json"))` está fuera de todo
try/except. El Agent Server persiste el checkpoint y la interrupción.

La web usa `useStream` 1.2.3, `stream.interrupts` y
`stream.respond(value, { interruptId })`. Un resume inválido o con otro action_id
se trata como rechazo. Rechazar vuelve al modelo con el resultado explícito y no
ejecuta cambios. No hay aprobación automática, persistencia de preferencias ni
aprobaciones compartidas entre acciones. Un payload que no pasa zod aparece como
"Acción no reconocida" y solo permite responder `approved: false`.

`actions.py` define propuestas y resume con Pydantic y prohíbe campos extra.
Los importes son strings PEN con dos decimales. El total histórico puede ser null,
igual que en las lecturas de Orders. `scripts/export_action_schema.py` genera
`packages/contracts/agent/agent-action.schema.json`; pytest comprueba igualdad
exacta. Pytest y Vitest validan los mismos fixtures JSON, incluidos valores
inválidos, y el smoke valida payloads y resumes contra el JSON Schema versionado.

### Carrito

Al aprobar, la web comprueba que el interrupt siga vigente, vuelve a consultar
Catalog y aplica una función pura con el producto actual. Suma unidades a una
línea existente, respeta stock, 20 líneas y checkout bloqueado, y calcula
`Math.round(product.price * 100)`. El grafo nunca escribe ni interpreta
localStorage: solo informa el resultado `applied`, cantidad final o motivo que
recibe en resume.

El contexto guarda las líneas y el resultado por action_id en un mismo snapshot.
Si se pierde el envío de resume, una recarga puede informar ese resultado sin
sumar otra vez. Un bloqueo de Web Locks serializa comprobación, aplicación y
respuesta entre pestañas del mismo origen cuando el navegador lo soporta. La
comprobación del interrupt actual también evita aplicar una tarjeta ya respondida.
Sin localStorage, el carrito y esa deduplicación duran la sesión en memoria.

### Cancelación y credenciales

Solo tras `interrupt` el nodo lee
`config.configurable.langgraph_auth_user.token`. El ToolNode usado para cada
llamada MCP inyecta ToolRuntime; el interceptor lee la configuración actual y
agrega Authorization únicamente a `list_my_orders`, `get_my_order` y
`cancel_my_order`. No se pasa el JWT como argumento, state, propuesta o resume.
El cliente del modelo recibe callbacks, sin configurable.

MCP sigue siendo el único adaptador HTTP de negocio. `cancel_my_order` llama una
sola vez a `POST /api/orders/{id}/cancel`, sin cuerpo ni reintentos. Anuncia
`readOnlyHint=false`, `destructiveHint=true`, `idempotentHint=true` y
`openWorldHint=false`. Proyecta solo order_id, status y already_cancelled. 202
significa cancelación nueva y 200 cancelación previa. 409 explica que ya finalizó
el pedido o el pago está en proceso; 404 conserva el texto que oculta pedidos
ajenos; 401 indica sesión vencida y fallos remotos muestran un mensaje fijo.
Los logs del MCP contienen nombre, duración y status, sin headers ni cuerpos.

### Respuestas duplicadas y diferencia encontrada

Con las versiones instaladas, el smoke comprobó que Agent Server 0.16.0 acepta
un segundo `command.resume` y responde 200 con el estado existente. El grafo no
repite el nodo ni el POST, pero el servidor no devuelve por sí solo el error
previsto en el diseño de la tarea.

Por eso el handler de autorización valida los resumes antes de crear el run.
Consulta el hilo con el cliente ASGI local del SDK, usando solo la credencial del
request actual, y exige un único interrupt pendiente y su ID vigente. Una
respuesta vieja, un hilo ocupado o sin interrupt devuelve 409
"Esta confirmación ya fue respondida". El cliente se cierra en cada llamada y no
cachea headers. Tampoco se permite reanudar un checkpoint histórico con una
aprobación vieja. El aislamiento por owner sigue aplicándose a esta lectura.
También se observó en useStream 1.2.3 / SDK 1.12.3 que el replay SSE de un turno
nuevo puede volver a incluir interrupts ya respondidos. El código instalado en
`stream/controller.js` agrega los eventos por orden de llegada. Las filas del chat
exigen una propuesta sin ToolMessage correspondiente en el último AIMessage y
seleccionan el último interrupt raíz. Mientras se ejecuta o carga el hilo no
muestran tarjetas históricas. Tras un resultado o una nueva respuesta del modelo,
las tarjetas desaparecen aunque el SDK reproduzca eventos antiguos. La consulta
autoritativa del hilo antes del cambio sigue validando el ID vigente. Vitest
reproduce el caso de un interrupt viejo junto al actual.

Orders conserva su propia idempotencia como defensa ante concurrencia o fallos
de transporte. La web deshabilita botones al primer clic y maneja 400/409 sin
volver a aplicar ni cancelar automáticamente.

## Consecuencias y verificación

El formulario del chat espera mientras existe una decisión pendiente. Las
confirmaciones ocupan el pie fijo del panel, fuera del historial desplazable.
Al aparecer, el scroller va al último mensaje y el foco usa preventScroll para
evitar saltos del navegador. La tarjeta sigue visible al revisar mensajes
anteriores. El resultado usa el aria-live existente.
Recargar rehidrata las interrupciones; las tarjetas respondidas desaparecen.
Después de una respuesta de cancelación se invalida la caché de pedidos.

Los tests cubren re-ejecución de lecturas, ID estable, decisiones inválidas y
viejas, múltiples propuestas, herramientas filtradas, errores HTTP y ausencia de
JWT en trazas locales. El smoke sin claves aprueba y rechaza ambas acciones,
renueva el JWT del mismo comprador, exige un solo POST, rechaza el segundo resume,
oculta pedidos ajenos y revisa state, interrupts, resumes y logs de ambos procesos.
CI conserva setup-uv v10.3.0 con uv 0.13.0 y no requiere secretos.

No se subieron langgraph 1.2.14, langgraph-api 0.16.0, @langchain/react 1.2.3 ni
@langchain/langgraph-sdk 1.12.3. Se declaró jsonschema 4.26.0 como dependencia de
desarrollo del agente para validar el contrato en smoke; ya estaba en el lock.

## Fuentes consultadas

Se abrieron antes de implementar, el 2026-10-12:

- [Interrupts y reglas del nodo](https://docs.langchain.com/oss/python/langgraph/interrupts).
- [Human-in-the-loop del Agent Server](https://docs.langchain.com/langsmith/add-human-in-the-loop).
- [Time travel del Agent Server](https://docs.langchain.com/langsmith/human-in-the-loop-time-travel).
- `apps/web/node_modules/@langchain/react/dist/use-stream.d.ts`, que confirma
  interrupciones raíz rehidratadas y `respond(value, { interruptId })`.

La diferencia del segundo resume se comprobó con el servidor instalado y se
contrastó con `langgraph_api.models.run.create_valid_run`. El cliente ASGI está
soportado por `langgraph_sdk.get_client(url=None)` y documentado en su docstring
instalado. El handler conserva el contrato de
[autorización de recursos](https://docs.langchain.com/langsmith/resource-auth).


## Verificación local del cambio 08

Pasaron uv sync --locked y ruff en ambos servicios, 89 pruebas del agente, 36 de
MCP y ambos smokes sin claves. La web pasó typecheck, lint, 77 pruebas Vitest y
build. El build conserva el aviso de chunks mayores de 500 kB.

`pnpm demo:agent` reconstruyó el perfil con claves reales. Con un comprador de
prueba y gpt-6-luna se verificaron carrito aprobado y rechazado, recarga con
confirmación pendiente, cancelación rechazada sin cambio y cancelación aprobada.
Para esta última se creó un pedido pendiente de prueba sin checkout ni cobro; se
comprobó su estado cancelado por Orders y en la vista de pedidos. El chat muestra
solo la propuesta actual tras varios turnos. La revisión en escritorio y móvil
confirmó foco, botones y ausencia de overflow horizontal. El detector de los
componentes modificados no encontró problemas mecánicos.

Se revisaron las trazas recientes del proyecto LangSmith y los logs de los dos
contenedores sin encontrar JWT ni Bearer. El smoke exige además ausencia de los
JWT concretos de prueba en state, interrupts, resume y logs. Son verificaciones
locales; no se ejecutó GitHub Actions ni se creó un commit.

## Concurrencia

`resume.py` consulta el hilo y luego Agent Server crea el run. Dos resumes
simultáneos pueden pasar la validación antes de que cambie el estado del hilo.
La consulta no es un bloqueo ni una operación atómica con la creación del run.

No hay un efecto doble de negocio. Orders responde 200 a una cancelación
repetida y la web conserva el primer resultado del carrito por `action_id`.
Conserva los 50 resultados más recientes por orden de inserción. Una confirmación
antigua debe rechazarse en el servidor; el registro local tiene una ventana finita.
Web Locks serializa pestañas del mismo origen cuando está disponible.
