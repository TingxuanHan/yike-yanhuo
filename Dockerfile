FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && mkdir -p .cache .data && chown -R node:node .cache .data
COPY --from=build /app/dist ./dist
USER node
ENV HOST=0.0.0.0 PORT=8787 NODE_ENV=production
EXPOSE 8787
CMD ["node", "dist/server/server/index.js"]
