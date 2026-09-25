# E-QuAART (API + web client in one container, SQLite database on a volume at /data)
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY server server
COPY client client
RUN cd server && npx prisma generate && npm run build && cd ../client && npx vite build

FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* && mkdir /data && chown node /data
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server server
COPY --from=build /app/client/dist client/dist
WORKDIR /app/server
USER node
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
