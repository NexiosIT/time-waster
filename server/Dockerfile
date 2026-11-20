FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:server

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/server/dist server/dist
ENV DB_PATH=/data/scores.db
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/v1/health || exit 1
CMD ["node", "server/dist/main.js"]
