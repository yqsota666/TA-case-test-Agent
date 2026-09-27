FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/transport/package.json packages/transport/package.json
COPY services/sales/package.json services/sales/package.json
RUN npm install --workspace @fund-demo/sales-service --include-workspace-root
COPY packages packages
COPY services/sales services/sales
CMD ["npm", "run", "start", "-w", "@fund-demo/sales-service"]
