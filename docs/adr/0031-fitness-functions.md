# ADR 0031: Fitness functions de arquitectura

- Fecha: 2026-10-13
- Estado: aceptado
- Rama: `v7-ai-agent`
- Antecedente: [ADR 0030](0030-evaluaciones-langsmith.md).

## Contexto

La revisión manual no impide introducir latencia, dependencias vulnerables,
secretos o imports entre servicios. Adoptamos fitness functions del enfoque de
_Building Evolutionary Architectures_, de Neal Ford, Rebecca Parsons y Patrick
Kua. Cada atributo tiene una medida, un umbral y un comando que devuelve un
código distinto de cero cuando falla.

## Decisión

k6 v2.3.0 envía búsqueda y conversaciones a Kong, que conserva el camino real
de routing y autenticación. Probar directamente los servicios ocultaría el
costo de verificar JWT en Identity y en el Agent Server. Un comprador sintético
obtiene su JWT por el flujo HTTP real, sin claves ni fixtures humanos.

El modelo echo y el clasificador de reglas aíslan el overhead de la plataforma
del costo y variabilidad de un LLM. El override vacía credenciales externas y
desactiva tracing. La imagen de `langgraph build` API 0.16.0 no arranca sin
licencia o LangSmith. Se comprobó ese rechazo localmente. Por eso la stack de
fitness usa Agent Server dev con API 0.16.0 y checkpoint en memoria. No se
modifican las versiones de LangGraph ni la stack habitual. La latencia del
checkpoint PostgreSQL licenciado no está cubierta por esta función.

Un script k6 contiene ambos escenarios y cinco requests que deben responder
401 sin JWT. El perfil local dura dos minutos, hasta 20 VUs por escenario. CI
usa cinco VUs por escenario durante 30 segundos. Los p95 se derivan del máximo
observado en tres mediciones locales multiplicado por 1,5 y redondeado hacia
arriba. Se conservan errores menores a 1% y checks mayores a 99%. La tabla
central registra valores, fecha, entorno y procedimiento de recalibración.

Trivy v0.75.0 es el único escáner de dependencias, secretos y configuración.
Cubre `pnpm-lock.yaml` y ambos `uv.lock`, incluidas dependencias de desarrollo.
No añadimos OSV-Scanner, `pnpm audit` ni `pip-audit`. HIGH y CRITICAL con solución
disponible hacen fallar el escaneo; `ignore-unfixed` omite vulnerabilidades sin
corrección publicada. El alcance es el árbol actual. Se decide no incorporar
gitleaks para el historial en esta tarea. Un secreto eliminado de la punta de
la rama queda fuera del escaneo y exige rotación y revisión del historial.

Se usa la imagen oficial fijada por digest del índice multiarch, montando el
repo en solo lectura. Local y CI ejecutan el mismo wrapper y `trivy.yaml`.
Evitamos `trivy-action` por su advisory de febrero de 2026 sobre inyección al
cargar un archivo de entorno. No se publican los reportes JSON del escáner:
un archivo temporal se elimina al salir y el log muestra solo ID, severidad,
archivo y línea. Los secretos nunca se imprimen como fragmentos de código.

Trivy no incorpora reglas nativas de Compose en esta versión. Se habilita su
parser YAML con `file-patterns` y reglas Rego propias para privilegios, namespaces
del host, overrides root, tags de imagen, socket Docker y puertos fuera de
loopback. Los Dockerfiles usan las reglas incorporadas. `MY-DOCKER-001` reutiliza
el check nativo de tags latest y lo eleva de MEDIUM a HIGH para que bloquee CI. Se deshabilitan las
exclusiones automáticas de secretos para tests, ejemplos y Markdown; esos
archivos también pueden contener una credencial commiteada.

La allowlist exige `id`, `paths`, `statement` y `expired_at` RFC3339. Una regla
Rego rechaza entradas sin alcance o justificación, vencidas o con vigencia
superior a 90 días. Una renovación exige revisar la exposición y la alternativa
de actualización. No se desactiva una familia de reglas por un hallazgo local.
La excepción inicial de Faker transitivo de Redocly vence el 31 de diciembre de 2026. Los parches compatibles de las otras dependencias se aplican en manifests
y overrides, actualizando el lock con pnpm.

dependency-cruiser 18.6.0 impide imports entre `apps/*`, imports de servicios
desde `packages/*` y rutas relativas a paquetes. La resolución por nombre
respeta `exports`; también falla un nombre `@mercadoya/*` que no resuelva. El
parser SWC 1.16.18 lee TS y TSX, incluidos imports de tipos, porque esta versión
de dependency-cruiser no admite el compilador TypeScript 7 instalado. No se
cambia TypeScript. Los dos ciclos actuales quedan como advertencias.

import-linter 2.15 verifica `agent_service` y `mercadoya_mcp` con paquetes
externos habilitados. Se usan contratos forbidden, sin forzar capas que no
reflejen el código actual. El agente accede al MCP por HTTP. Las reglas de
oxlint no sustituyen un grafo de dependencias entre servicios y paquetes.
Fixtures temporales prueban cada prohibición y el aviso de ciclos; se eliminan
en `finally`. Los tests de seguridad prueban un secreto AWS sintético y un
Compose inseguro contra el escáner real.

## CI y consecuencias

`security` y `agent-smoke` no dependen de `validate`, por lo que corren en
paralelo. TypeScript se revisa después de lint en `validate`; Python en
`agent-smoke`. El job `perf` depende de `validate`, prepara una sola stack
independiente con `--wait`, ejecuta k6 una sola vez y limpia volúmenes siempre.
El smoke de Identity conserva su stack y sus aserciones funcionales.

`security` tiene timeout de seis minutos y cache de la DB Trivy. `perf` tiene
timeout de doce minutos y cache Buildx de capas por servicio, sin publicar
imágenes. El objetivo habitual es menos de seis minutos por job nuevo. Los
tiempos locales y la diferencia frente al runner GitHub están en la tabla
central. Los tiempos reales de Actions deben comprobarse al subir el cambio;
las mediciones locales no se presentan como tiempos de CI.

Las nuevas actions están fijadas por SHA. Ningún job nuevo recibe secretos del
repositorio ni usa Grafana Cloud, OpenAI, Cloudflare o LangSmith. Los artifacts
contienen solo métricas. Las funciones no sustituyen SAST, DAST, SBOM firmado ni
escaneo de imágenes publicadas; quedan como posibles tareas posteriores.

## Fuentes

- [k6, thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/).
- [Trivy, configuración y filtros](https://trivy.dev/latest/docs/configuration/filtering/).
- [Trivy, checks propios](https://trivy.dev/docs/latest/scanner/misconfiguration/custom/).
- [Trivy Action, advisories](https://github.com/aquasecurity/trivy-action/security/advisories).
- [dependency-cruiser 18.6.0, reglas](https://github.com/sverweij/dependency-cruiser/blob/v18.6.0/doc/rules-reference.md).
- [import-linter, contratos](https://import-linter.readthedocs.io/en/stable/contract_types.html).
