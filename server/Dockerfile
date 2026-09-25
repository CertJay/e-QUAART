# E-QuAART API
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --include-workspace-root
COPY server server
RUN cd server && npx prisma generate && npm run build

FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/prisma server/prisma
COPY --from=build /app/server/scripts server/scripts
COPY --from=build /app/server/src server/src
WORKDIR /app/server
USER node
EXPOSE 4000
# Apply pending migrations, then start. Never runs the demo seed in production.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
