# Multi-stage build for SvelteKit host

FROM node:20-bookworm AS base
WORKDIR /app

COPY package.json package-lock.json* ./

FROM base AS deps
RUN npm install
RUN cp -a node_modules /opt/node_modules

FROM deps AS build
COPY . .
RUN npm run build

FROM node:18-bullseye AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules

EXPOSE 3000
CMD ["node", "build"]
