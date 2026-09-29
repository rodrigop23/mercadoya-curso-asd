# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary audience is the course learners and instructors using MercadoYa as a cumulative exercise in application architecture. The example workflows have two product actors: visitors who browse the public catalog and administrator accounts that publish products.

## Product Purpose

MercadoYa is a teaching system for application architecture. It demonstrates architectural change through a working local-market catalog, while keeping the user-facing workflows recognizable between versions. Skill-guided UI improvement is a practical activity learners can apply to the system; teaching design itself is not the course's primary subject.

Success means learners can follow how the implementation evolves from a naive version to a modular monolith, and can use design skills to improve the interface around those workflows.

## Positioning

The course compares V0 and V1 using the same registration, login, public catalog, and administrator product-publishing scenario. V1 places Identity and Catalog behind explicit module boundaries while retaining one backend deploy and one PostgreSQL database. UI skill work provides a hands-on improvement exercise around this architecture example.

## Operating Context

The system is used for course demonstrations and walkthroughs. The repository documents the V0 naive implementation and the V1 modular implementation on separate branches. Learners can inspect the web flows and trace the V1 Identity and Catalog contracts in the API.

## Capabilities and Constraints

- The web app supports email-and-password registration and login, a public product catalog, and administrator-only product publishing.
- Product listings contain a title, description, price in Peruvian soles (PEN), stock count, and image. The publishing form accepts JPG, PNG, or WebP images up to 5 MB.
- The current application has no cart, order, checkout, payment, or delivery workflow.
- The demonstrated backend remains a monolith with one Hono deploy and one PostgreSQL database. Identity and Catalog are separate internal modules in V1; they are not separate services.
- The web app uses React, Vite, and TanStack Router. Existing code and ADRs establish the stack, so future work should preserve it unless the course changes that decision.

## Evidence on Hand

- The repository contains the walkthroughs in `docs/demo-v0.md` and `docs/demo-v1.md`, accepted architecture decisions in `docs/adr/`, and C4 diagrams in `docs/diagrams/`.
- The web and API code provide working examples of the documented registration, catalog, and administrator publishing flows.
- No verified store or customer evidence, testimonials, or real-world marketplace results are provided in the repository. Do not invent them for the teaching example.

## Product Principles

- Teach architectural change through the same recognizable product workflows at each stage.
- Keep the architecture monolithic until the course has evidence for a real need to distribute a module.
- Make dependencies between Identity and Catalog explicit through contracts.
- Treat UI improvement as applied skill practice that supports the architecture example.
- Keep product claims within the implemented scope; the catalog is not a complete shopping or fulfillment service.
