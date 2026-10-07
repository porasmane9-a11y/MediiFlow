FROM node:20-alpine

WORKDIR /app

# Copy package files and project assets
COPY package*.json ./
COPY server.js ./
COPY database.json ./
COPY *.html ./
COPY css/ ./css/
COPY js/ ./js/

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
