# ADR 0029: Especialistas con router determinista

- Fecha: 2026-10-13
- Estado: aceptado
- Rama: `v7-ai-agent`
- Antecedentes: [ADR 0026](0026-acciones-con-confirmacion.md), [ADR 0028](0028-clasificador-dominio-clef.md).

## Decisión

El único grafo publicado sigue siendo `agent`. El padre ejecuta `input_guard`,
`domain_guard` y `route`, y luego uno de dos subgrafos compilados, `shopping` o
`post_sale`. Ambos vuelven al `output_guard` del padre. `langgraph.json` y las
versiones de las dependencias conservan su configuración anterior.

`domain_guard` guarda la categoría que ya obtuvo de Clef, o de las reglas del CI,
en `last_domain_category`. El router puro devuelve `Command` con el destino,
`active_agent` y `route_reason`. Productos y carrito van a compras; pedidos y
pagos/envíos van a postventa. Preferencias y conversación conservan el último
especialista válido, con compras como valor inicial. Su motivo es `sticky`.
Un error del clasificador con fail-open limpia la categoría y usa esta misma
regla, sin reutilizar una categoría vieja. Los rechazos terminan antes del router.

No se añade una llamada a un modelo por turno. Un supervisor LLM añadiría
latencia, costo y una decisión probabilística donde ya existe una categoría.
Los subagentes como herramientas requieren que otro modelo elija y procese la
llamada. Los handoffs trasladan el control mediante herramientas y complican
la confirmación y las llamadas paralelas. Aquí el padre conserva el control.
La [guía de migración de langgraph-supervisor](https://docs.langchain.com/oss/python/migrate/langgraph-supervisor)
indica que el paquete ya no se mantiene activamente. Recomienda subagentes como
herramientas para supervisores y un `StateGraph` propio cuando se necesitan pasos
deterministas, ruteo fijo o subgrafos detectables. Se elige este último patrón;
no se añade esa dependencia.

## Estado y aislamiento

Los subgrafos comparten `AgentState`, incluidos `messages`, los flags, el último
especialista y la categoría. Se agregan directamente como nodos compilados,
sin wrapper ni checkpointer propio. Heredan la persistencia y el Store del padre.
La historia compartida conserva las evidencias y permite continuar un turno con
otro especialista. Los recuerdos siguen en `("memories", identity)`, aislados
por comprador y disponibles desde ambos especialistas. Se mantiene `trim_messages`.

Una fábrica implementa `assistant`, `tools` y `confirm_action` para ambos. Cada
modelo recibe su propio prompt y solo sus lecturas, su propuesta y las herramientas
de memoria. El `ToolNode` excluye herramientas ajenas. `confirm_action` rechaza
propuestas fuera del conjunto permitido antes de consultar MCP o interrumpir.
`cancel_my_order` solo se ejecuta tras aprobación y nunca se enlaza al modelo.

Los guardrails quedan en el padre. La validación de la respuesta también ocurre
antes del checkpoint del especialista, mediante una función compartida. La
validación de evidencias y fuga de instrucciones usa el prompt del especialista
activo, incluido el historial recortado que recibió el modelo.

## Reanudación dentro del subgrafo

Antes de implementar se consultaron las páginas oficiales de
[subgrafos](https://docs.langchain.com/oss/python/langgraph/use-subgraphs) e
[interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts), y se ejecutó
una prueba con LangGraph 1.2.14. `test_subgraph_resume.py` conserva esa prueba.

El interrupt llega al padre y `Command(resume={interrupt_id: decision})` en el
mismo `thread_id` continúa el subgrafo. Con el subgrafo compilado como nodo,
`route` y el primer `assistant` se ejecutan una vez; el nodo interrumpido se
reinicia. Con un wrapper que invoca el subgrafo, también se reinicia el wrapper.
La documentación de interrupts describe explícitamente este segundo caso.
No se encontró una diferencia de semántica; se precisa qué código se repite.

Por eso la validación anterior a `interrupt` solo hace lecturas idempotentes.
El `action_id` sigue derivándose con `uuid5` del id de la llamada y el JWT se lee
después del interrupt desde la solicitud nueva. Los tests comprueban el token
renovado, el mismo id y que el padre no vuelve a ejecutar los guards ni el router.
La propuesta mantiene exactamente el contrato JSON existente de la web.

Agent Server 0.16.0 publica el interrupt del subgrafo en el hilo padre. El smoke
comprueba que `resume.py` sigue rechazando el duplicado con 409 mediante
`threads.get`; no hace falta buscar otro `checkpoint_ns`. El estado interno se
puede inspeccionar con `subgraphs=true`, y el stream con `stream_subgraphs=true`.

## Observabilidad y verificación

Cada subgrafo se compila con su nombre y `with_config` asigna `agent:shopping`
o `agent:post_sale`, junto a `agent_name`. Antes del modelo se añade
`route_reason` desde el estado. Se actualizan también los spans
activos del subgrafo en los tracers, enlazados por `parent_run_id`, antes de su
exportación. Así la metadata no queda limitada a los nodos internos ni depende
del orden de los callbacks de LangChain. Se registra `record_event(config, "route", reason,
agent)` una vez al entrar al bucle, sin texto ni identidad. El modelo recibe
callbacks, tags de especialista y esas dos claves de metadata, sin configurable.

Las pruebas sin claves cubren la tabla de ruteo, aislamiento, memoria compartida,
HITL, reanudación y los guardrails existentes. El smoke inspecciona el estado con
subgrafos y los eventos SSE de cada especialista, incluidos sus tags y metadata,
y conserva los casos anteriores de autenticación, dominio, memoria y acciones.

## Compatibilidad del chat y validación local

La prueba real detectó un límite del filtro de tarjetas en `agent-messages.ts`:
exigía una propuesta en el historial del padre, pero el último AIMessage con
la tool call queda en el checkpoint del especialista hasta que termina. El
interrupt y su payload ya estaban disponibles en el hilo padre; la tarjeta
quedaba oculta tanto en vivo como al recargar.

Se autorizó una excepción al alcance inicial para ajustar esa detección y sus
tests. Se aceptan los interrupts vigentes del SDK cuyo namespace pertenece a
`shopping` o `post_sale`, sin exigir una tool call en los mensajes raíz. El SDK
reconcilia los interrupts con `state.tasks` al rehidratar y después de reanudar.
Se conserva el filtro anterior para eventos históricos raíz y se ocultan las
tarjetas durante la carga. La comprobación de vigencia antes de aplicar la
acción sigue usando el hilo autenticado. No cambian el componente visual,
`applyAgentCartProposal`, el schema, ni las versiones del SDK.

Pasaron `uv sync --locked`, Ruff y los 336 tests de Python, ambos smokes sin
claves, y `langgraph dev` con la configuración original. La representación
expandida de Studio incluye assistant, tools y confirm_action en cada
especialista, con destinos condicionales explícitos. La web pasó tsc, oxlint,
83 tests de Vitest y build con Node 24.14.1 y pnpm 11.8.0.

Con `pnpm demo:agent`, Clef y el modelo reales, el catálogo local no tenía
audífonos: el agente respondió sin inventarlos. Se verificó compras con Palta
Hass y una aprobación que actualizó el carrito de 2 a 3 unidades. Para postventa
se creó un pedido de prueba con la API existente, se pidió cancelar el último,
se aprobó la tarjeta y se comprobó el estado `cancelled`. La cuenta antes solo
tenía un pedido ya cancelado, que el agente reconoció sin ofrecer otra acción.
Las tarjetas resueltas no reaparecieron al recargar. "hazme la tarea" recibió la
negativa, sin especialista ni llamadas al modelo principal en ese run.

Las trazas reales muestran los tags y la metadata de cada especialista y ningún
LLM en `route`. Se revisaron las exportaciones recientes y los logs del agente
y MCP sin encontrar JWT, claves ni los textos de prueba en los logs. Durante la
prueba, Clef rechazó una vez "busca Palta Hass"; la petición explícita de comprar
ese producto sí fue admitida. Se registra esta observación del clasificador
existente sin ampliar los cambios de dominio de esta tarea.
