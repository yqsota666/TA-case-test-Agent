FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/transport/package.json packages/transport/package.json
COPY services/ta/package.json services/ta/package.json
RUN npm install --workspace @fund-demo/ta-service --include-workspace-root
COPY packages packages
COPY services/ta services/ta
CMD ["npm", "run", "start", "-w", "@fund-demo/ta-service"]
