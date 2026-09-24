FROM node:24.19.0-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/stellar-api/package.json apps/stellar-api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/stellar-core/package.json packages/stellar-core/package.json

RUN npm ci --workspace @multisig-tools/stellar-api --include-workspace-root=false --no-audit --no-fund

COPY tsconfig.json ./
COPY apps/stellar-api apps/stellar-api
COPY packages/stellar-core packages/stellar-core

ENV NODE_ENV=production
ENV PORT=3000

USER node

CMD ["./node_modules/.bin/tsx", "apps/stellar-api/stellar/platform/node/server.ts"]
