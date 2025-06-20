FROM node:20-alpine AS base
WORKDIR /usr/src/app
ENV NODE_ENV=production

FROM base AS dependencies
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile --prod

FROM base AS build
COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY . .

FROM base AS release
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/src ./src
COPY --from=build /usr/src/app/package.json ./

USER node

EXPOSE 3000

CMD [ "node", "src/server.js" ]
