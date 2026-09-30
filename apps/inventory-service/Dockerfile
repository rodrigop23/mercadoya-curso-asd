FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN npm install -g pnpm@11.8.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/inventory-service/package.json apps/inventory-service/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
RUN pnpm install --frozen-lockfile
COPY packages/tsconfig packages/tsconfig
COPY packages/contracts packages/contracts
COPY apps/inventory-service apps/inventory-service
RUN pnpm --filter @mercadoya/contracts build
RUN pnpm --filter @mercadoya/inventory-service build
RUN pnpm --filter @mercadoya/inventory-service deploy --legacy --prod /runtime

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3003 IDENTITY_URL=http://host.docker.internal:3001
COPY --from=build /runtime ./
COPY --from=build /workspace/apps/inventory-service/openapi.yaml ./openapi.yaml
USER node
EXPOSE 3003
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3003/api/inventory/'+(process.env.SERVICE_VERSION||'v2')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
