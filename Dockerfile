FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY workflows ./workflows

RUN npm run build

ENV NODE_ENV=production
ENV DATA_ROOT=/data

EXPOSE 3000
CMD ["node", "dist/src/app.js"]
