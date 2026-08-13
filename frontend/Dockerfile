# Frontend TanStack Start (SPA) compilé puis servi par Nginx
# (proxy /api, /ws, /admin vers le backend Django/Daphne)
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
# La sortie SPA statique est dans dist/client (mode sans SSR).
COPY --from=build /app/dist/client /usr/share/nginx/html

EXPOSE 80
