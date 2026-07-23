# syntax=docker/dockerfile:1

# ------------------------------------------------------------------ build
# Both stages MUST be the same image: better-sqlite3 compiles a native
# binding here, nitro traces it into .output/server/node_modules, and the
# runtime stage needs an identical Node ABI + libc (musl) to load it.
FROM node:22-alpine AS build

# Toolchain for node-gyp, in case no prebuilt better-sqlite3 binding
# matches this platform and it has to compile from source.
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

# ---------------------------------------------------------------- runtime
FROM node:22-alpine

ENV NODE_ENV=production \
    NITRO_PORT=3000 \
    NUXT_DATA_DIR=/data

WORKDIR /app

COPY --from=build /app/.output ./.output

# Persistent analytics data (SQLite DB, replay files, GeoIP db).
RUN mkdir -p /data && chown node:node /data

USER node
VOLUME /data
EXPOSE 3000

# start-period covers first-boot migrations; the GeoIP download is
# background-only and never blocks readiness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", ".output/server/index.mjs"]
