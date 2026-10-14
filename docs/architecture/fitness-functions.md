# Fitness functions de arquitectura

Fecha de implementación y mediciones: 13 de octubre de 2026. Cada función
convierte un atributo de calidad en un chequeo ejecutable. Un error sale con
código distinto de cero y bloquea CI. La decisión está en
[ADR 0031](../adr/0031-fitness-functions.md).

| Función                                    | Atributo de calidad    | Métrica                                                                   | Umbral                                                                                                         | Dónde corre                                    | Herramienta y versión                  | Comando                                                                                           | Qué hacer si falla                                                                                                                                |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Búsqueda por Kong                          | Rendimiento            | p95 de `catalog_search`                                                   | `p(95)<30 ms`                                                                                                  | Local; CI `perf`, 30 s                         | k6 2.3.0                               | `pnpm perf:local` / `pnpm perf:ci`                                                                | Revisar query, PostgreSQL y Kong con los mismos 1000 productos; repetir tres veces antes de cambiar el umbral.                                    |
| Conversación echo por Kong                 | Rendimiento            | p95 de `agent_chat`, solo `runs/wait`                                     | `p(95)<1550 ms`                                                                                                | Local; CI `perf`, 30 s                         | k6 2.3.0, Agent Server 0.16.0 dev      | Los mismos comandos de rendimiento                                                                | Revisar auth, grafo, guardrails y checkpoint en memoria. Confirmar echo y rules.                                                                  |
| Requests esperados                         | Disponibilidad         | `http_req_failed`                                                         | `< 0.01`                                                                                                       | Local; CI `perf`                               | k6 2.3.0                               | Los mismos comandos de rendimiento                                                                | Corregir 5xx, timeouts o rutas. CI aborta desde 10 s si cruza el límite.                                                                          |
| Respuestas válidas y protección del agente | Corrección y seguridad | `checks`                                                                  | `> 0.99`; cinco requests sin JWT deben ser 401                                                                 | Local; CI `perf`                               | k6 2.3.0                               | Los mismos comandos de rendimiento                                                                | Revisar forma `{products: []}`, mensajes echo y protección de `/api/agent`. Un 401 esperado solo se excluye del error HTTP de ese request.        |
| Dependencias TS y Python                   | Seguridad              | Vulnerabilidades en pnpm y ambos uv locks, incluidas dev                  | Cero HIGH/CRITICAL con solución, salvo excepciones vigentes                                                    | Local; CI `security`, paralelo a `validate`    | Trivy 0.75.0 por digest                | `pnpm security:scan`                                                                              | Aplicar un parche compatible con pnpm/uv y verificar locks. Si requiere un cambio incompatible, justificar una excepción acotada con vencimiento. |
| Secretos en el árbol actual                | Seguridad              | Matches de secretos, incluidos tests y Markdown                           | Cero HIGH/CRITICAL fuera de allowlist vigente                                                                  | Local; CI `security`                           | Trivy 0.75.0                           | `pnpm security:scan`; negativo `pnpm security:test`                                               | Retirar la credencial, rotarla si fue real y revisar el historial. No copiarla al ticket ni al log.                                               |
| Dockerfiles y Compose                      | Seguridad              | Misconfiguración incorporada y Rego `MY-COMPOSE-001/002`, `MY-DOCKER-001` | Cero HIGH/CRITICAL: sin root explícito, latest, privilegios, namespaces host, socket Docker o puertos públicos | Local; CI `security`                           | Trivy 0.75.0, Rego                     | `pnpm security:scan`; negativo `pnpm security:test`                                               | Corregir el Dockerfile/Compose. Si el caso local es intencional, permitir solo ID y archivo concretos con una fecha de vencimiento.               |
| Vigencia de excepciones                    | Seguridad              | `MY-EXCEPTIONS-001`                                                       | `id`, `paths`, `statement`, `expired_at` RFC3339; vigencia restante entre 0 y 90 días                          | Local; CI `security`                           | Trivy 0.75.0, Rego                     | `pnpm security:scan`                                                                              | Eliminar la excepción y corregir el hallazgo, o revisar la exposición antes de renovar.                                                           |
| Independencia TS de servicios              | Modificabilidad        | `no-cross-service`                                                        | Cero imports `apps/X` a `apps/Y`                                                                               | Local; CI `validate`, después de lint          | dependency-cruiser 18.6.0, SWC 1.16.18 | `pnpm deps:check`; negativo `pnpm deps:test`                                                      | Usar HTTP/eventos/contratos. Una violación existente requiere revisión antes de refactors grandes.                                                |
| Paquetes sin internals de servicios        | Modificabilidad        | `no-service-internals-from-packages`                                      | Cero imports `packages/*` a `apps/*`                                                                           | Local; CI `validate`                           | dependency-cruiser 18.6.0              | `pnpm deps:check`                                                                                 | Mover el contrato compartido a un paquete; mantener implementación en su servicio.                                                                |
| Entrada pública de paquetes                | Encapsulación          | `only-public-package-entry`, `no-unresolved-workspace-package`            | Cero rutas relativas a paquetes o nombres públicos que no resuelvan sus exports                                | Local; CI `validate`                           | dependency-cruiser 18.6.0              | `pnpm deps:check`                                                                                 | Importar el nombre `@mercadoya/*` y un export declarado. Verificar `packages/*/package.json`.                                                     |
| Ciclos TS                                  | Modificabilidad        | `no-circular`                                                             | Advertencia; dos ciclos actuales, no bloquea aún                                                               | Local; CI `validate`                           | dependency-cruiser 18.6.0              | `pnpm deps:check`                                                                                 | Revisar nuevos ciclos. La conversión a error exige resolver la base existente en otra tarea.                                                      |
| Independencia Python                       | Modificabilidad        | Contratos forbidden                                                       | Cero imports `agent_service` a `mercadoya_mcp`/`mcp_server`, y viceversa                                       | Local; CI `agent-smoke`, paralelo a `validate` | import-linter 2.15                     | `uv run lint-imports` en ambos servicios; negativo `python3 tests/architecture/python-imports.py` | Usar MCP por HTTP y los contratos versionados. No instalar el código del otro servicio como dependencia.                                          |

## Base de rendimiento y umbrales

Las tres corridas usan la stack aislada `mercadoya-perf`, 1000 productos
sintéticos de `tests/perf/seed.sql`, PostgreSQL 18, Kong 3.9.1 y Agent Server dev
0.16.0 con echo, rules y tracing apagado. El host es macOS arm64 con OrbStack,
Docker Engine 29.4.0, Node 24.14.1, pnpm 11.8.0 y uv 0.13.0.

Se ejecuta el perfil local durante dos minutos, con ambos escenarios
concurrentes hasta 20 VUs cada uno. Cada iteración espera 200 ms. Un hilo nuevo
evita que el historial crezca y altere el trabajo entre iteraciones. La
latencia del chat excluye crear/borrar el hilo; estos requests sí cuentan en
la tasa de errores. No se usa un LLM remoto ni la API de LangSmith.

| Corrida local | p95 catálogo, ms | p95 agente, ms | Errores HTTP | Checks correctos |
| ------------- | ---------------: | -------------: | -----------: | ---------------: |
| 1             |          12,1610 |      1024,8572 |           0% |             100% |
| 2             |          13,7246 |      1022,0278 |           0% |             100% |
| 3             |          10,8564 |      1027,6177 |           0% |             100% |

Se descartó una corrida exploratoria cuyo catálogo comenzó vacío; las tres
filas anteriores usan la semilla completa durante toda la carga. Las dos
primeras cruzaron el límite inicial de 800 ms del agente, y proporcionaron
la base para calibrarlo. La tercera ejecutó `pnpm perf:local` completo y pasó
con exit 0 en 232,89 segundos, incluida una reconstrucción sin cache de varias
imágenes.

El umbral es el máximo p95 observado entre las tres corridas por 1,5,
redondeado hacia arriba a 10 ms para catálogo y 50 ms para agente:

- Catálogo: 13,7246 × 1,5 = 20,5869 ms, umbral estricto `p(95)<30`.
- Agente: 1027,6177 × 1,5 = 1541,42655 ms, umbral estricto `p(95)<1550`.

Los límites iniciales de 300/800 ms eran hipótesis. El ensayo corto mostró
unos 872 ms para el agente y rechazó el límite de 800 ms con exit 99. El perfil
CI conserva los umbrales locales, cambia solo duración y VUs.

Los checkpoints del modo dev son en memoria. La imagen habitual de
`langgraph build` requiere licencia/LangSmith, por lo que medir su checkpoint
PostgreSQL incumpliría la condición de no usar claves. Esta limitación impide
interpretar el resultado como una base del runtime licenciado de producción.

`BASE_URL` apunta a Kong en `http://localhost:18000`. `setup()` rechaza destinos
remotos antes de enviar requests salvo `K6_ALLOW_REMOTE=1`. El JWT y las cookies
quedan en memoria del proceso k6; el artifact solo contiene `metrics`.

Para recalibrar, mantener la semilla, las versiones, los VUs y los filtros,
repetir tres corridas sin otras pruebas de carga simultáneas y actualizar
ambos umbrales, esta base y la justificación de la ADR en el mismo cambio. Un
fallo de CI exige investigar primero, no ampliar el límite automáticamente.

## Alcance y excepciones de seguridad

`trivy.yaml` contiene la misma política para local y CI. La imagen está fijada
al digest multiarch
`sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa`.
Se monta el repositorio en solo lectura y se conserva la DB en `~/.cache/trivy`.
El escaneo cubre `pnpm-lock.yaml` y los dos `uv.lock`, incluso dependencias dev.
No hay escáneres duplicados ni uso de `trivy-action`.

Se omiten instalaciones y salidas generadas `node_modules`, `.venv`, `dist`,
`cdk.out`, `.git` y `tests/perf/out`, además de los archivos locales ignorados
`.env` y `.env.evals`. Los ejemplos de env versionados sí se escanean. El
escaneo del árbol actual no encuentra un secreto eliminado en un commit anterior;
el análisis del historial con gitleaks queda para una decisión posterior.

Trivy no tiene checks incorporados de Compose. `file-patterns` habilita el
parser YAML y las reglas Rego propias. Sus tests negativos comprueban la
detección real. `MY-DOCKER-001` eleva a HIGH el check nativo de tags latest,
cuya severidad incorporada es MEDIUM y quedaría fuera del gate solicitado. Las reglas también revisan overrides de Compose; un override
no debe introducir privilegios ni publicar puertos fuera de loopback.

Se corrigieron SDK MCP 1.30.0 a 1.31.0, adm-zip 0.6.0 a 0.6.1, handlebars 4.7.9
a 4.7.10, sharp 0.35.4 a 0.35.5, source-map-js 1.2.1 a 1.2.2 y undici 7.29.0 a
7.29.1. No se cambiaron versiones de Node, pnpm, uv, LangGraph ni de servicios.
Las vulnerabilidades sin parche publicado se omiten con `ignore-unfixed`, según
el diseño solicitado.

La excepción `CVE-2026-73231` permite exclusivamente el Faker 7.6.0 transitivo
de Redocly 2.0.0 en `pnpm-lock.yaml`. Se usa para contratos locales y no recibe
templates externos de `faker.helpers.fake`. La corrección exige Faker 10.5.0,
un cambio mayor que debe probarse con la actualización de Redocly. Vence el
31 de diciembre de 2026. No permite otras vulnerabilidades ni otros archivos.

El wrapper evita imprimir matches de secretos. Su JSON temporal se elimina
al salir, tanto si pasa como si falla. Los logs contienen solamente ID,
severidad, archivo y línea; no se sube un reporte de secretos como artifact.

## Límites y base de imports

El parser SWC permite mantener TypeScript 7 y detectar imports solo de tipos.
La resolución de nombres de paquetes aplica `exportsFields: ['exports']`.
Un import público de `@mercadoya/ui/lib/utils` que resuelve a
`packages/ui/src/lib/utils.ts` pasa; el import relativo al mismo archivo falla.
Un subpath privado por nombre público también falla. Las reglas comprueban
imports estáticos y literales; no modelan rutas construidas dinámicamente ni
acoplamiento mediante tablas de otra base de datos.

La base actual tiene cero errores de límites y dos advertencias de ciclos:

- `apps/web/src/features/cart/apply-agent-cart-proposal.ts` con `cart-context.tsx`.
- `apps/mf-catalog/src/admin-products.tsx` con `catalog-slice.tsx`.

Python incluye paquetes externos en el grafo para detectar imports prohibidos
aunque el otro servicio no esté instalado. No se agrega un contrato de capas:
forzar un orden interno del agente requeriría un refactor ajeno a esta tarea.

## CI y tiempos

`security` y `agent-smoke` comienzan en paralelo con `validate`. Los imports TS
se comprueban después de lint en `validate`, y los Python en `agent-smoke`.
`perf` espera a `validate` y ejecuta k6 una sola vez sobre su Compose separado.
La stack del smoke Identity sigue dedicada a sus pruebas funcionales.

El timeout es seis minutos para `security` y doce para `perf`. El objetivo de
duración habitual de ambos jobs nuevos es menos de seis minutos. Buildx guarda
capas por servicio en la cache de Actions; Trivy conserva su DB y checks bundle.
Todas las actions nuevas están fijadas por SHA y ningún job nuevo recibe
secretos del repositorio.

El comando completo `pnpm perf:local` tardó 232,89 segundos en la tercera
medición. El escaneo completo con cache caliente tardó 6,25 segundos localmente. La
primera descarga de DB/imágenes es adicional. El comando completo `pnpm perf:ci` pasó después de restaurar Kong en
69,85 segundos, incluida preparación con cache y carga de 30 segundos. Sus
p95 fueron 15,3797 ms para catálogo y 870,0202 ms para agente, con 0% de errores
y 100% de checks. Los siete tests de imports tardaron unos 4,5 segundos. Estos valores son del host local; los tiempos y
estados reales de los jobs GitHub deben verificarse después del commit y push
del humano.

## Verificación de fallo

`pnpm deps:test` introduce fixtures temporales para todas las reglas, incluido
el aviso de ciclos, y los elimina en `finally`. Los checks Python pasan y
rechazan ambos sentidos del import prohibido.

`pnpm security:test` introduce una clave AWS sintética, un Dockerfile root y un Compose con
`privileged: true`, `alpine:latest` y un puerto público. El escaneo real debe
salir con 1 e informar `aws-access-key-id`, `DS-0002`, `MY-DOCKER-001`, `MY-COMPOSE-001` y `MY-COMPOSE-002`.
También se prueban excepciones vencidas y superiores a 90 días. Los archivos
desaparecen en `finally` y el test no imprime la clave sintética.

La prueba de latencia agregó un retraso temporal de dos segundos en Kong,
solo en `runs/wait`, sin modificar el código del agente. Elevó su p95 a
2949,4445 ms y k6 salió con 99, con `✗` en `agent_chat`. Los checks siguieron
en 100% y los errores HTTP en 0%; el fallo provino del umbral de latencia.
El test restauró Kong y eliminó los overrides temporales. La guía de
reproducción está en [tests/perf](../../tests/perf/README.md).
