FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json ./
RUN npm install --production

# Copy source
COPY server.js analyzer.js alerts.js ./

# Create log directory mount point
RUN mkdir -p /var/log/puppet

EXPOSE 3000

CMD ["node", "server.js"]
