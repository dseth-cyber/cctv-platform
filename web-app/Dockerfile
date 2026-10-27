# ── Build stage ──
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --frozen-lockfile --ignore-scripts

COPY tsconfig.json vite.config.ts postcss.config.js tailwind.config.js index.html ./
COPY public/ ./public/
COPY src/ ./src/
RUN npm run build

# ── Serve stage ──
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
