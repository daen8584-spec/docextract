# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The build only needs a syntactically valid URL; no page queries the database at build time.
RUN DATABASE_URL=postgresql://build@127.0.0.1:5432/build npm run build

# One image serves three roles, selected by the command: the web app (default), the
# worker (tsx worker/index.ts) and migrations (drizzle-kit migrate). The worker and the
# migration tool are development dependencies, so node_modules is kept whole.
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# OCR of scanned PDFs (docs/adr/0008): pdftoppm renders pages, Tesseract reads them.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng poppler-utils \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "--port", "3000"]
