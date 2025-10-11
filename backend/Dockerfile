# Backend Dockerfile
FROM node:20-bookworm-slim AS build
WORKDIR /app
# Copy manifests first for caching, plus Prisma schema so postinstall can generate
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
COPY prisma ./prisma
# Install build deps required for canvas (cairo/pango/jpeg/gif) & other native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
		build-essential \
		python3 \
		pkg-config \
		libcairo2-dev \
		libpango1.0-dev \
		libjpeg-dev \
		libgif-dev \
		librsvg2-dev \
	&& rm -rf /var/lib/apt/lists/*
RUN npm ci || npm install
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Install runtime libs (lighter than full -dev packages) needed for canvas & TTS tools
RUN apt-get update && apt-get install -y --no-install-recommends \
		ca-certificates \
		openssl \
		espeak-ng \
		lame \
		sox \
    libcairo2 \
    libpango-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
EXPOSE 8080
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
# Override the Node image entrypoint so our shell script runs (and not `node /app/docker-entrypoint.sh`)
ENTRYPOINT ["/app/docker-entrypoint.sh"]
