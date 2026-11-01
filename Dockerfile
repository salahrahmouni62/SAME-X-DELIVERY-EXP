FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts
# In a container the app must listen on all interfaces; publish the port only to a reverse proxy.
# Pass SETUP_TOKEN (docker run -e SETUP_TOKEN=...) to allow the first supervisor to be created from the web.
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/app/data TRUST_PROXY=true COOKIE_SECURE=true
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server.js"]
