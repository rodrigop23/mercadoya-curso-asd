FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN npm install -g pnpm@11.8.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/jwt-verifier/package.json packages/jwt-verifier/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
RUN pnpm install --frozen-lockfile
COPY packages/tsconfig packages/tsconfig
COPY packages/contracts packages/contracts
COPY packages/jwt-verifier packages/jwt-verifier
COPY apps/api apps/api
RUN pnpm --filter @mercadoya/api... build
RUN pnpm --filter @mercadoya/api deploy --legacy --prod /runtime
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY --from=build /runtime ./
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
