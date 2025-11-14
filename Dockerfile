FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm ci && npm prune --omit=dev

COPY . .

EXPOSE 8080

CMD ["node", "src/index.js"]

