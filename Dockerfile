FROM node:20-slim
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY . .
ENV DB_PATH=/data/agente.db
ENV COMPANY_CONFIG_DIR=/data/companies
CMD ["sh", "-c", "mkdir -p \"$COMPANY_CONFIG_DIR\" && cp -n /app/companies/*.json \"$COMPANY_CONFIG_DIR/\" 2>/dev/null || true; exec node server.js"]
