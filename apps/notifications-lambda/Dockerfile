FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN npm install -g pnpm@11.8.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/notifications-lambda/package.json apps/notifications-lambda/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/jwt-verifier/package.json packages/jwt-verifier/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
RUN pnpm install --frozen-lockfile
COPY packages/tsconfig packages/tsconfig
COPY packages/contracts packages/contracts
COPY packages/jwt-verifier packages/jwt-verifier
COPY apps/notifications-lambda apps/notifications-lambda
RUN pnpm --filter @mercadoya/notifications-lambda... build
RUN pnpm --filter @mercadoya/notifications-lambda deploy --legacy --prod /runtime
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3004
COPY --from=build /runtime ./
USER node
EXPOSE 3004
CMD ["node", "dist/src/bridge.js"]
