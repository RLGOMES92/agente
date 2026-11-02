FROM node:20-slim
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY . .
ENV DB_PATH=/data/agente.db
VOLUME /data
CMD ["node", "server.js"]
