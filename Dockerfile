FROM node:22-alpine
RUN addgroup -g 1001 app && adduser -u 1001 -G app -s /bin/sh -D app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js db.js app.js mcp-server.js index.html login.html login.js styles.css sw.js manifest.json openapi.yaml ./
COPY icon-192.png icon-512.png favicon.ico ./
COPY lib/ lib/
COPY lang/ lang/
COPY scripts/ scripts/
RUN mkdir -p backups calendars data/photos && chown -R app:app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
