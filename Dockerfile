# syntax=docker/dockerfile:1
FROM node:22-alpine AS build

WORKDIR /app

# Keep dependency installation in its own cached layer.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --no-audit --no-fund

COPY index.html admin.html vite.config.js ./
COPY src ./src
COPY public ./public
ARG VITE_SITE_URL
RUN npm run build

FROM nginx:alpine AS runtime

COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
