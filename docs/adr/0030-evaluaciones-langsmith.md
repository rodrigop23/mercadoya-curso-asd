# ADR 0030: Evaluaciones del agente con LangSmith

- Fecha: 2026-10-13
- Estado: aceptado
- Rama: `v7-ai-agent`
- Antecedentes: [ADR 0028](0028-clasificador-dominio-clef.md), [ADR 0029](0029-multiagente-router.md).

## Decisión

Se evalúa el grafo completo en proceso mediante `evals.target.run_case`. Cada
caso compila el builder real con `InMemorySaver`, `InMemoryStore`, un hilo nuevo
y una identidad de evaluación. Se ejecuta un único `ainvoke`. Si aparece un
`interrupt`, se devuelve su propuesta y nunca se reanuda. El agente publicado,
sus prompts, el router y los guardrails conservan su implementación.

El target devuelve clasificación, especialista, motivo de ruta, herramientas,
propuesta, llamadas de escritura, bloqueo, respuesta y contexto de herramientas.
Un interceptor observa también las lecturas de validación anteriores al interrupt,
que todavía no aparecen en los mensajes del grafo padre. Sus datos pasan por el
saneamiento existente. `ContextVar` separa observaciones de casos concurrentes.
La dependencia MCP se sustituye durante la evaluación, sin cambiar producción.

Toda llamada MCP distinta de las cinco lecturas permitidas queda registrada en
`executed_writes` y se rechaza antes del transporte. Este campo es conservador:
un intento de escritura también hace fallar la evaluación aunque la barrera haya
impedido ejecutarlo. El carrito se modifica desde la web al reanudar y la
cancelación exige reanudar el grafo. Ninguno de esos pasos ocurre aquí.

## Dataset y versiones

`apps/agent-service/evals/agent_cases.jsonl` es la fuente de verdad. Contiene 38
casos con id estable, split y `metadata.kind`: 14 de dominio, ocho de ruteo, ocho
de herramientas, cuatro de propuestas y cuatro de guardrails. Los 14 primeros
reutilizan literalmente un subconjunto del dataset de la ADR 0028, con su historial
y referencias. `scripts/eval_domain.py` y sus 40 casos permanecen como benchmark
independiente del clasificador.

Los casos usan texto ficticio. Los comandos `scripted` y escenarios `fixture`
sirven únicamente para offline. Los marcadores `{product_id}` y `{order_id}` se
resuelven en el target con UUID ficticios offline y con ids del comprador de demo
en local. El JWT vive en el entorno y en el config de ejecución; nunca se guarda
en el JSONL ni se devuelve. El experimento registra un hash de los ids elegidos
para detectar cambios de fixtures entre comparaciones.

El sync usa `metadata.case_id` como identidad, compara inputs, outputs, metadata
y splits, crea los nuevos, actualiza los cambiados y borra los retirados. Una
segunda ejecución no muta ejemplos si nada cambió. `--tag v1` etiqueta el timestamp
de la versión resultante; el runner puede fijarla con `--dataset-tag v1`. Los tags
se vuelven a asignar solo cuando se solicita `--tag`. Para comparar corridas se
usa el mismo tag, los mismos fixtures y `--no-sync`. El script solo imprime
cantidades. [SDK de datasets](https://docs.langchain.com/langsmith/manage-datasets-programmatically)
y [versiones y tags](https://docs.langchain.com/langsmith/manage-datasets).

## Dos modos

Offline fuerza modelo scripted, clasificador de reglas, moderación apagada y MCP
falso. Comparte `FakeMCP` con los tests de acciones existentes. El runner elimina
del entorno temporal las claves de IA, desactiva tracing y test tracking, y no
construye un `langsmith.Client`. No sincroniza ejemplos ni publica experimentos.
Los tests bloquean sockets y el constructor del cliente incluso con claves y
tracing heredados. El resumen JSON informa medias, cantidad de muestras, medias
por kind y fallos por id. Los umbrales de `thresholds.json` hacen fallar CI.

Local carga la configuración con `uv run --env-file .env.evals`, sin exportar
variables en la terminal. `.env.evals.example` documenta las mismas variables sin
credenciales. El archivo privado necesita claves de LangSmith, OpenAI y
Cloudflare, token interno MCP, JWT de demo vigente y los dos ids. Identity emite
JWT de cinco minutos, por lo que se renuevan antes de cada corrida. El runner
comprueba formato y `exp` antes de crear clientes y antes de cada caso; un JWT
vencido durante la corrida produce un error de ejecución. La firma y la identidad
siguen bajo validación de los servicios. El runner
fuerza OpenAI y Clef, permite elegir `clef` o `clef-flash` por
entorno y ejecuta `aevaluate` sobre `list_examples` de la versión elegida. Hay una
repetición y concurrencia dos por defecto, limitada a cuatro. Los tags `eval` y
`agent:<nombre>` identifican la ejecución y el especialista. La metadata incluye
modelo, clasificador, modelo clasificador, git SHA, hash de prompts, versión del
dataset, hash de fixtures, hash del código de evaluación y modelo de los jueces. El resumen incluye la URL.
Los umbrales locales informan regresiones, sin bloquear por calidad. Los errores
de ejecución o de jueces sí indican una evaluación incompleta.

Se elige `aevaluate` porque el dataset es homogéneo, el target es asíncrono y se
necesitan experimentos comparables sobre ejemplos versionados. Pytest comprueba
la infraestructura y el aislamiento sin sincronizar tests individuales. No se
activa `@pytest.mark.langsmith` ni se depende del dry run del plugin.
[Evaluación asíncrona](https://docs.langchain.com/langsmith/evaluation-async).

## Evaluadores y límites de interpretación

Los evaluadores de código son puros y sus comentarios contienen solo el id. Dominio
y categoría aplican a `domain`; ruta, a `routing`; selección, a `tools`; propuesta
sin escrituras, a `proposal`; bloqueo, a `guardrail`. La ausencia de PII es una
invariante de todos los casos y usa `contains_pii`. Precios aplica a herramientas,
propuestas y guardrails y reutiliza `amounts_in` y `evidence` del guardrail de
salida, incluidos sus múltiplos permitidos. No se vuelve a implementar el detector.
Los kinds restantes reciben score nulo. Los presupuestos en preguntas de dominio,
como `in_budget`, no son evidencia de herramientas y quedan fuera de ese score.
El detector conserva el alcance y las limitaciones del guardrail existente.

Offline tiene umbral 1.0 en todos los scores aplicables. `tool_selected` comprueba
que un comando scripted llegue a la herramienta permitida y respete exclusiones.
**No mide la selección de herramientas por el modelo**. Tampoco mide la calidad
semántica de OpenAI, la precisión de Clef, su latencia real ni la autenticación o
los datos del MCP desplegado. Valida el pipeline, los evaluadores, las rutas, los
guardrails y las propuestas detenidas. La calidad del modelo se mide en local.

Los jueces locales de groundedness y helpfulness usan `openevals==0.2.0`, prompts
RAG oficiales y `create_async_llm_as_judge`, con claves de feedback explícitas.
Omiten rechazos de dominio o entrada y groundedness también se omite cuando no
hay evidencia MCP útil. Una consulta exitosa vacía, como `{"orders": []}`, sí es
evidencia; `[]` o `[{}]` no lo son. Groundedness evalúa la respuesta o los hechos
obtenidos del MCP incluidos en la propuesta. No evalúa `action_id`, el tipo de
acción ni la cantidad pedida, que no provienen del retrieval. Helpfulness evalúa
la respuesta o propuesta con acción y cantidad, junto con la entrada e historial
con los ids resueltos. Ningún juez necesita el id técnico de la acción. El contexto
MCP y el input de los jueces pasan por el saneamiento existente. `AGENT_EVAL_JUDGE_MODEL` usa el modelo del agente por defecto. Sin
clave OpenAI la fábrica omite los jueces; el runner local exige la clave antes
de sincronizar. Los jueces no solicitan razonamiento y el wrapper devuelve solo
score e id. Los errores se convierten en feedback nulo con indicador de error,
sin publicar la excepción como comentario. [OpenEvals 0.2.0](https://pypi.org/project/openevals/0.2.0/).

El código es determinista y barato, pero solo mide las propiedades formalizadas.
Los jueces añaden hasta dos llamadas por ejemplo aplicable, tienen variación y sesgos del modelo,
y pueden juzgar mal un rechazo o una propuesta sin respuesta textual. Sus scores
sirven para inspeccionar ejemplos, no sustituyen las invariantes de seguridad.
Las metas locales son dominio 0.95, ruta 0.90, herramienta 0.85 y propuesta/PII 1.0.

`openevals` pertenece al grupo opcional `evals`. Resolverlo agregó `langchain` como
dependencia nueva, sin subir `langchain-core==1.6.9`, `langchain-openai==1.7.0`,
`langsmith==0.14.7`, `langgraph==1.2.14` ni `langgraph-api==0.16.0`. El Agent Server
instala las dependencias de producción y no carga este grupo ni los jueces.

## Presupuesto y validación

Developer ofrece una cuenta, 5k trazas base mensuales y retención base de 14 días.
Se desactiva el tracing de evaluadores con `disable_evaluator_tracing=True`; los
feedbacks se publican igualmente. La estimación es de unas 38 trazas raíz de
aplicación por corrida, con sus spans hijos. Dos experimentos consumen unas 76,
sin contar otras sesiones o reintentos. No se crean evaluadores online, reglas
UI, colas ni trabajos recurrentes. La concurrencia baja limita presión sobre las
APIs, pero no reduce el total de llamadas. [Plan y retención](https://www.langchain.com/pricing).

Por corrida se esperan unas 37 llamadas Clef, 40 a 60 llamadas del agente OpenAI
y unas 40 a 55 llamadas de jueces OpenAI, con máximo de 76 si todos aplican a ambos
jueces. Es una estimación, no una cuota: los rechazos,
las herramientas elegidas y los reintentos cambian el total. El README explica
cómo comparar base/flash y cómo conectar el MCP privado sin modificar Kong.

CI ejecuta la evaluación offline además de pytest y los dos smokes previos. Los
tests cubren evaluadores positivos/negativos, interrupciones, aislamiento entre
casos, sync idempotente, umbral imposible, ausencia de red/cliente, jueces y el
cableado local con clientes falsos. La creación de experimentos reales y la
comparación en la UI requieren credenciales locales; no se ejecutan en CI.

## Revisión tras el primer experimento

La primera corrida de 38 casos sobre `v1` tuvo cero errores técnicos y cero
escrituras MCP. Tres propuestas no cumplieron la referencia: `cancel_explicit` y
`cancel_followup` recibieron un rechazo de sesión vencida; `cart_first` perdió la
referencia al producto porque su historial comenzaba con un mensaje AI que
`trim_history` descarta. `product_stock` respondió stock real consultando
`get_product`, una alternativa válida que la referencia no aceptaba. Los jueces
RAG puntuaron también saludos y rechazos sin evidencia MCP; 26 casos no tenían
contexto útil. Esos promedios mezclaban criterios no aplicables.
También hubo discrepancias de categoría en `in_other` e `in_quantity`, que Clef
clasificó como productos, y en `in_yes`, que clasificó como carrito. Sus referencias
de conversación se conservan para medir esas diferencias en futuras corridas.

Se conserva el experimento y su tag `v1`. La versión `v2` añade el turno humano
previo en los nuevos historiales de propuestas y routing y admite las dos lecturas
válidas de stock. Los 14 casos de dominio siguen idénticos a su fuente, y no se
modifican prompts del agente, router, guardrails, umbrales ni las exclusiones de
herramientas. La política de jueces descrita arriba evita pedir groundedness sin
evidencia y helpfulness para pedidos bloqueados. `skipped` muestra esas omisiones
y `count` conserva el denominador real. Los errores del juez siguen en `errors`.

Las corridas nuevas usan `--dataset-tag v2`, con prefijos `base-v2` y `flash-v2`.
La metadata `evaluation_hash` identifica también cambios del código de evaluación,
porque `git_sha` puede ser el mismo durante una sesión sin commits. No se comparan
los promedios de jueces de `v1` con los de `v2` como si su alcance fuera idéntico.
