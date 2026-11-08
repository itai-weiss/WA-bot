FROM node:20-bookworm-slim

ENV HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    PUPPETEER_CACHE_DIR=/opt/puppeteer \
    TZ=Asia/Jerusalem

WORKDIR /app

COPY package.json package-lock.json ./
# whatsapp-web.js is a GitHub tarball dependency; git is not needed for it.
RUN PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev \
 && apt-get update \
 && npx puppeteer browsers install chrome --install-deps \
 && rm -rf /var/lib/apt/lists/* /root/.npm

COPY *.js ./
COPY public ./public

VOLUME /data
EXPOSE 3000

# Chrome refuses to start if a previous container left its profile lock behind.
# Only the lock files are removed; the WhatsApp session itself stays.
# ponytail: runs as root (Chrome has --no-sandbox); switch to the node user if the
# data volume ownership is sorted out.
CMD ["sh", "-c", "rm -f /data/.wwebjs_auth/session/Singleton* && exec node server.js"]
