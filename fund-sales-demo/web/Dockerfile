FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY web/package.json web/package.json
RUN npm install --workspace @fund-demo/web --include-workspace-root
COPY packages/protocol packages/protocol
COPY web web
RUN npm run build -w @fund-demo/web
FROM nginx:1.29-alpine
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
