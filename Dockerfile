FROM node:24-bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential binutils-arm-none-eabi gcc-arm-none-eabi \
    libnewlib-arm-none-eabi libpng-dev pkg-config \
    ca-certificates curl git unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY scripts/get-pokefirered.sh scripts/fetch-vendor.sh scripts/build-rom.sh ./scripts/
COPY scripts/generate-species-data.mjs ./scripts/
COPY scripts/shims ./scripts/shims
COPY patches ./patches
COPY web/species-data.js ./web/species-data.js
RUN bash scripts/get-pokefirered.sh \
    && node scripts/generate-species-data.mjs --check \
    && bash scripts/fetch-vendor.sh \
    && bash scripts/build-rom.sh

FROM build AS vercel-build
COPY web ./web
COPY scripts/build-vercel.mjs scripts/wordle-api.mjs scripts/http-headers.mjs ./scripts/
RUN node scripts/build-vercel.mjs

# docker build --target vercel-export --output type=local,dest=.vercel .
FROM scratch AS vercel-export
COPY --from=vercel-build /app/.vercel/output /output

FROM node:24-bookworm-slim AS standalone
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY web ./web
COPY --from=build /app/web/vendor ./web/vendor
COPY --from=build /app/web/game ./web/game
COPY scripts/serve.mjs scripts/wordle-api.mjs scripts/http-headers.mjs ./scripts/
USER node
EXPOSE 8080
CMD ["node", "scripts/serve.mjs"]
