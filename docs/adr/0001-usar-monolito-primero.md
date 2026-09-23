# 1. Usar monolito primero para MercadoYa

## Status

Accepted

## Context

MercadoYa se reinicia desde cero como práctica acumulativa del curso. El alcance inicial es pequeño: autenticación (registro/login), administración de productos y catálogo público. El equipo (y los AI coding agents) podrían inclinarse a partir en microservicios o en varios deploys “por si crece”.

La teoría de la sesión enfatiza *Monolith First*: la mayoría de sistemas distribuidos exitosos nacieron de un monolito que permitió descubrir límites reales; ir directo a microservicios suele aumentar complejidad global (red, latencia, operación) sin evidencia de que haga falta.

Necesitamos una base simple de desplegar, fácil de demostrar en clase, y que aún así pueda evolucionar (módulos, capas, y más adelante extracción selectiva de capacidades).

## Decision

Construiremos MercadoYa como **un monolito**: un solo proceso/deploy de backend y una sola base de datos en esta etapa. La modularidad interna (subdominios Identidad y Catálogo) se abordará después, dentro del mismo deploy, no con servicios remotos.

No adoptamos microservicios, mensajería entre bounded contexts ni bases de datos por servicio en esta fase.

## Consequences

**Más fácil:** arranque rápido; un solo pipeline y entorno; demos de walkthrough en ~50 min; los AI agents tienen un target claro (una app); podemos contrastar V0 “naive” vs V1 modular sin cambiar el modelo de despliegue.

**Más difícil / trade-offs:** el deploy escala como una unidad (quanta = 1); un fallo puede afectar todo el producto; si más adelante un subdominio necesita independencia fuerte, habrá que extraerlo con cuidado (strangler), no “gratis”.

**Seguimiento:** ADR sobre stack de implementación; ADR sobre límites de módulos Identity/Catalog cuando pasemos a monolito modular.
