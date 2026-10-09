FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
RUN mkdir -p /app/data && chown node:node /app/data
ENV NODE_ENV=production PORT=8080 DATABASE_FILE=/app/data/app.db
EXPOSE 8080
ENTRYPOINT ["sh", "scripts/container-entrypoint.sh"]
CMD ["node", "scripts/start-live.js"]
