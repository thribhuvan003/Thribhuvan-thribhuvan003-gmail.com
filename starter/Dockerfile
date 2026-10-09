FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
RUN mkdir -p /app/data && chown node:node /app/data
ENV NODE_ENV=production PORT=8080 DATABASE_FILE=/app/data/app.db
USER node
EXPOSE 8080
CMD ["node", "scripts/start-live.js"]
