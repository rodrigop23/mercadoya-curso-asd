# ADR 0028: Lista permitida de temas con Cloudflare Clef

- Fecha: 2026-10-13
- Estado: aceptado
- Rama: `v7-ai-agent`
- Antecedente: [ADR 0027](0027-guardrails-memoria.md).

## Contexto y decisión

El filtro anterior rechazaba temas previstos y permitía consultas ambiguas. Así
pasaban tareas de matemáticas, clima y recetas. Se adopta una lista permitida
estricta para compras en MercadoYa. Sus categorías son productos, carrito,
pedidos, pagos y envíos, preferencias y conversación. Conversación incluye
saludos, agradecimientos, capacidades y seguimientos de compras. Los comandos
de memoria pertenecen al dominio. Todo lo demás recibe exactamente:

> Solo puedo ayudarte con compras en MercadoYa: productos, carrito, pedidos y tus preferencias.

`input_guard` conserva redacción de PII, longitud original, inyección y moderación
opcional. Después ejecuta `domain_guard`, con su propia traza, y solo una decisión
permitida llega a `assistant`. Ambos rechazos terminan en END. Un rechazo de tema
sustituye el mensaje humano por `[mensaje bloqueado]`, conservando su id. No
ejecuta el modelo principal ni herramientas. Se eliminan `ALIEN_TOPICS`,
`STORE_TOPICS` e `is_off_topic` de producción. La memoria conserva validación de
PII, inyección, longitud y formato de sus datos tipados, sin otro filtro de temas.

Clef recibe preguntas `choice` y `noul` y devuelve decisiones tipadas con
probabilidades. Esto permite ajustar el umbral sin generar texto. Un LLM
generativo con salida estructurada añadiría generación y otra configuración.
Se descarta el clasificador con OpenAI. El modelo principal sigue usando su
proveedor actual; no cambian sus versiones.

Se elige `clef`. El benchmark oficial de detección fuera de dominio CLINC150+OOS
publica macro-F1 de 97,43 para clef y 66,77 para clef-flash. Las medianas oficiales
son 209 y 39 ms, con p95 de 239 y 122 ms. Son mediciones del proveedor, sin
garantía de esa latencia desde Perú. Se prioriza la calidad de detección frente
a ese ahorro. [Blog oficial](https://blog.cloudflare.com/clef-decision-models/).

## Petición, contexto y decisión

`domain.py` contiene el contrato `DomainDecision`, las siete categorías y las dos
preguntas compartidas con el evaluador. El estado incluye tienda y moneda, el
mensaje actual y seis mensajes previos human/ai redactados. El texto AI se limita
a 300 caracteres. No incluye ToolMessages, tool_calls ni el system prompt.
La redacción se aplica otra vez al preparar la petición. `confirmacion_reciente`
indica una propuesta reciente o una confirmación respondida en el turno anterior.
El state conserva ese indicador después de `confirm_action`.

Se rechaza si la categoría es `fuera_de_dominio` o si `en_dominio` es menor que
`AGENT_CLASSIFIER_MIN_IN_DOMAIN`, por defecto 0,5. La confianza de la categoría
y la probabilidad binaria se registran por separado. Los últimos seis mensajes
mantienen el contexto acotado. Clef tiene 65.536 tokens de ventana y trunca el
state textual cuando excede el espacio disponible. No dependemos de esa
truncación para aplicar el límite de entrada.
[Ficha de Clef](https://developers.cloudflare.com/workers-ai/models/clef/).

Las reanudaciones de interrupt continúan en `confirm_action`, sin ejecutar
`input_guard` ni `domain_guard`. Si el último mensaje no es humano, el clasificador
no actúa. El bucle de herramientas tampoco regresa al clasificador.

## Respuesta REST observada y diferencia de endpoints

Antes de codificar se hizo una llamada real con curl. Devolvió HTTP 200:

```json
{"result":{"model":"clef","answers":{"categoria":{"type":"choice","choice":"productos","probabilities":{"productos":0.9691,"fuera_de_dominio":0.0309},"confidence":0.8803},"en_dominio":{"type":"noul","noul":0.9839}},"usage":{"input_tokens":269,"output_tokens":0}},"success":true,"errors":[],"messages":[]}
```

El formato observado de noul es un objeto con la clave `noul`, no un número
desnudo ni un campo `probability`. El parser acepta las tres formas, con y sin
envoltorio `result`. Valida categorías conocidas y números finitos de 0 a 1,
incluidos confianza y probabilidades de categoría. Rechaza booleans, campos
ausentes, JSON inválido y `success: false`.

La evaluación detectó otra diferencia respecto al diseño inicial. Enviar
`model=clef-flash` a `/ai/run/@cf/cloudflare/clef` devolvió HTTP 422:

```json
{"errors":[{"message":"AiError: AiError: {\"error\":{\"type\":\"invalid_request\",\"message\":\"Unsupported model 'clef-flash'. Use 'clef'.\"}} (b12ea209-3467-4a57-a57e-8261ab331551)","code":5012}],"success":false,"result":{},"messages":[]}
```

Una petición a `/ai/run/@cf/cloudflare/clef-flash`, con `model=clef-flash`, devolvió
HTTP 200 y `{"type":"noul","noul":0.9703}`. Por eso la implementación selecciona
el sufijo REST según el modelo. No reintenta ni cambia de modelo ante errores.
La [ficha de clef-flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/)
muestra ese endpoint. La compatibilidad OpenAI de Workers AI no cubre estas
preguntas; se utiliza `/ai/run`, sin chat completions.

## Fallos, cliente y privacidad

HTTP no 2xx, error de red, timeout y respuesta inválida producen un error de
clasificación. Se cierra el turno con:

> No pude procesar tu mensaje en este momento. Inténtalo de nuevo en unos segundos.

El mensaje humano redactado conserva contenido e id porque no se juzgó el tema.
No se ejecuta el modelo ni se reintenta automáticamente. Los subtipos son
`timeout`, `http_4xx`, `http_5xx`, `invalid_response` y `unconfigured`. Errores de
red y redirecciones se registran como `invalid_response`. Las excepciones tienen
mensajes fijos y no conservan excepciones HTTP con datos sensibles como contexto.

`AGENT_CLASSIFIER_FAIL_OPEN=false` es el valor por defecto, explícito en CI.
`true` permite continuar solo cuando se configura para desarrollo local. Fallar
abierto anularía la lista permitida cuando Clef no responde; fallar cerrado cuesta
un reintento manual ocasional. Compose usa false por defecto.

Si faltan claves, el servidor arranca y su lifespan registra una vez
`classifier=clef_unconfigured`. Cada consulta recibe el mensaje de fallo. Nunca
cambia a reglas automáticamente. OpenAI usa Clef por defecto; echo y scripted
usan reglas. CI fija reglas explícitamente y no recibe secretos Cloudflare.

Un único `httpx.AsyncClient` por proceso se crea al necesitarlo, con timeout de
dos segundos, `trust_env=False` y cero reintentos. Cada petición lee el token
del entorno y añade su propio header. No hay token en cliente, módulo o headers
por defecto. Agent Server 0.16.0 permite un app Starlette con lifespan mediante
`http.app`; se aprovecha para cerrar el cliente al apagar. Importar el grafo
no abre conexiones. HTTPX ya resolvía 0.28.1 y ahora es dependencia explícita.
[Transportes HTTPX](https://www.python-httpx.org/advanced/transports/).

La metadata registra `domain_category`, `domain_in_domain`, `domain_confidence`,
`domain_in_domain_probability`, `domain_classifier`, `domain_model` y
`domain_latency_ms`. Los errores añaden subtipo y fail_open. `record_event`
añade categoría, acción y tags a la traza de dominio y a los ancestros disponibles
del árbol en ejecución. El contador de logs
incluye guardrail, categoría, acción y acumulado por proceso. Se suprimen los logs
de HTTPX/httpcore durante peticiones a Clef porque pueden contener URL y headers.
No se registra mensaje, historial, account id ni token. El anonimizador oculta
campos de credenciales Cloudflare, account id y cualquier campo `cf-aig-*`.
Las trazas de conversación siguen la política de redacción y ocultamiento de
ADR 0027.

## Dependencia externa y costo

Workers AI requiere red, cuenta y cupo. Una solución completamente local no
tendría esa dependencia, pero exigiría recursos y operación del modelo. El
cierre ante fallos limita el riesgo. Los pesos son Apache-2.0 y pueden servirse
con SGLang en `/v1/systemone`, con el mismo cuerpo y respuesta tipada, como
alternativa futura fuera del alcance de esta tarea.
[Pesos y API local](https://huggingface.co/Cloudflare/clef).

Clef cuesta USD 0,24 por millón de tokens de entrada, equivalente a 21.818
neuronas; clef-flash, USD 0,038 y 3.455 neuronas. No se cobran tokens de salida.
Workers AI incluye 10.000 neuronas diarias gratis; en Paid, el exceso cuesta
USD 0,011 por mil neuronas. Cuarenta casos de unos mil tokens consumirían cerca
de 873 neuronas con Clef y costarían USD 0,0096 antes del cupo gratuito.
[Precios](https://developers.cloudflare.com/workers-ai/platform/pricing/).

La página de límites consultada el 2026-10-13 publica límites por tarea, incluido
Text Classification a 2.000 peticiones/minuto, pero no enumera un límite propio
de Clef. No se presenta esa cifra como un límite confirmado del modelo.
El eval ejecuta secuencialmente y deja 100 ms entre casos, sin reintentos.
[Límites](https://developers.cloudflare.com/workers-ai/platform/limits/).

## Dataset y verificación

`evals/domain_cases.jsonl` tiene 40 casos, 20 permitidos y 20 ajenos, con historial,
confirmación reciente, etiqueta binaria y categoría. No hay `rules_skip`. Se
puede reutilizar para evaluar en LangSmith; no se sube automáticamente. Las reglas
normalizan tildes y mayúsculas, reconocen categorías y seguimientos de hasta seis
palabras según el turno anterior. El grafo conserva el resultado de dominio del
turno anterior para que una respuesta breve sin palabras de tienda no corte el
seguimiento. En scripted, los comandos se reconocen por nombre de herramienta.
La variable `AGENT_TEST_CLASSIFIER_TIMEOUT=1` solo habilita el caso fake
`/test classifier_timeout` en echo/scripted con reglas, nunca con Clef.

`scripts/eval_domain.py --model both` imprime precisión binaria, precisión de
categoría, matriz por categoría, discrepancias, falsos positivos/negativos por
id y p50/p95. Los fallos cuentan contra la precisión global. Sin claves sale 0
con un aviso; no se ejecuta en CI.

En la evaluación real con umbral 0,5, Clef logró 100 % de precisión binaria,
92,5 % por categoría, p50 583 ms y p95 1.136 ms. No hubo falsos positivos,
falsos negativos ni errores. Los ids `in_other`, `in_quantity` e `in_yes` recibieron
categorías productos o carrito en vez de conversación, sin afectar la admisión.
Clef-flash logró 70 % binario, 90 % por categoría, p50 453 ms y p95 619 ms.
Sus falsos negativos fueron `in_budget`, `in_quantity`, `in_thanks`, `in_hello`,
`in_capabilities`, `in_remember`, `in_memory`, `in_forget`, `in_cancel`, `in_yape`,
`in_stock` e `in_gift`; no hubo falsos positivos. Se conserva Clef por defecto.

La verificación cubre MockTransport sin red, token por petición, contexto
redactado, ambas envolturas y tres formatos noul, rechazo/umbral, HTTP
401/403/429/500, JSON y probabilidades inválidos, timeout, red y falta de claves.
Pytest comprueba ruteo, mensaje intacto ante fallo, fail_open explícito, metadata
sin datos sensibles, inyección previa y reanudación sin clasificador. Los smokes
sin secretos incluyen seis temas ajenos, códigos de tienda, seguimientos,
agradecimientos, memoria, acciones y timeout fake. CI mantiene setup-uv v10.3.0
y uv 0.13.0. La evaluación real no sustituye una evaluación amplia de producción.

La validación final pasó `uv sync --locked`, Ruff y pytest en ambas apps, con
313 tests del agente y 36 del MCP. Pasaron ambos smokes sin claves y
`docker compose --profile agent --env-file .env.example config`. No cambió la web;
su estado vacío ya describe productos, carrito, pedidos y preferencias.

`pnpm demo:agent` construyó la imagen final con Postgres y claves reales. El token
tenía un filtro de IP que permitía el host y rechazaba Docker con 401; el servicio
cerró el turno con el mensaje de reintento. El dueño retiró ese filtro y se repitió
la prueba. Matemáticas, clima de Lima y receta de ceviche recibieron la negativa
exacta sin herramientas. La búsqueda con presupuesto y "¿y el otro?" funcionaron,
y se aprobaron las confirmaciones de carrito y cancelación. El pedido temporal
quedó cancelado. Se eliminaron comprador, productos, pedido e hilos temporales.
Se revisaron 78 runs de LangSmith. Las tres trazas rechazadas tienen metadata
`domain_*` en `domain_guard` y no tienen nodos assistant/tools ni runs LLM.
La metadata y los logs de agente/MCP no contienen token, account id ni los textos
de prueba. La metadata de dominio queda en su nodo propio; la raíz del Agent
Server no conserva esas actualizaciones de los ancestros en esta versión.

## Ruteo por categoría

La [ADR 0029](0029-multiagente-router.md) reutiliza la categoría de esta decisión
para elegir compras o postventa. La guarda en el estado y conserva los rechazos
en el padre, sin añadir una llamada a un LLM para el ruteo.

## Evaluación del grafo completo

La [ADR 0030](0030-evaluaciones-langsmith.md) reutiliza 14 de estos casos en
`agent_cases.jsonl` para evaluar el grafo completo, con pipeline offline en CI y
experimentos locales en LangSmith. `scripts/eval_domain.py` y los 40 casos de
`domain_cases.jsonl` se mantienen sin cambios como benchmark aislado de Clef.
