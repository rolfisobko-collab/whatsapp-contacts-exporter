FROM node:20-slim

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
