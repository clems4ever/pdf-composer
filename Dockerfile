# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts && npm cache clean --force \
 # keep only the browser builds the app serves
 && rm -rf node_modules/pdfjs-dist/legacy node_modules/pdfjs-dist/types \
      node_modules/pdf-lib/cjs node_modules/pdf-lib/es node_modules/pdf-lib/src node_modules/pdf-lib/ts3.4 \
 && find node_modules -name '*.map' -delete

FROM node:22-alpine
ENV NODE_ENV=production PORT=8000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY public ./public
# The app never writes anywhere; run unprivileged (and ideally with --read-only).
USER node
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
