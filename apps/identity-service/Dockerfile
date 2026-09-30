FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN npm install -g pnpm@11.8.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/identity-service/package.json apps/identity-service/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/jwt-verifier/package.json packages/jwt-verifier/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
RUN pnpm install --frozen-lockfile
COPY packages/tsconfig packages/tsconfig
COPY packages/contracts packages/contracts
COPY packages/jwt-verifier packages/jwt-verifier
COPY apps/identity-service apps/identity-service
RUN pnpm --filter @mercadoya/identity-service... build
RUN pnpm --filter @mercadoya/identity-service deploy --legacy --prod /runtime
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3006
COPY --from=build /runtime ./
USER node
EXPOSE 3006
CMD ["node", "dist/index.js"]
