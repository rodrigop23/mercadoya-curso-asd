FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN npm install -g pnpm@11.8.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/catalog-service/package.json apps/catalog-service/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/jwt-verifier/package.json packages/jwt-verifier/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
RUN pnpm install --frozen-lockfile
COPY packages/tsconfig packages/tsconfig
COPY packages/contracts packages/contracts
COPY packages/jwt-verifier packages/jwt-verifier
COPY apps/catalog-service apps/catalog-service
RUN pnpm --filter @mercadoya/catalog-service... build
RUN pnpm --filter @mercadoya/catalog-service deploy --legacy --prod /runtime
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3007
COPY --from=build /runtime ./
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3007
CMD ["node", "dist/index.js"]
