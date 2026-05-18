FROM docker.io/library/node:22-alpine

RUN apk add --no-cache bash

WORKDIR /home/app
# WORKDIR creates /home/app owned by root by default. Hand it to `node` so
# tools that need to write to it (e.g. vitest's coverage temp dir) work.
RUN chown -R node:node /home/app

# Install dependencies into the image so node_modules lives entirely inside
# the container. The host never needs Node installed.
COPY --chown=node:node package*.json .npmrc ./
RUN npm ci --ignore-scripts

# Defaults baked into the image so the container can also do a one-shot build
# without any bind mounts. In dev these paths are overlaid by docker-compose.
COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node src ./src

USER node

# Continuously type-check and emit ./out/extension.js on every save.
# fixedPollingInterval is the most reliable watch mode across the Docker
# Desktop bind-mount boundary on Windows/macOS.
CMD ["npx", "tsc", "-p", ".", "--watch", "--preserveWatchOutput", "--watchFile", "fixedPollingInterval"]
