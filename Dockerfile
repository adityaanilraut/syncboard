FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=build --chown=node:node /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/src/protocol.ts ./src/protocol.ts
COPY --from=build --chown=node:node /app/server ./server
USER node
EXPOSE 3000
CMD ["node", "--import", "tsx", "server/index.ts"]
