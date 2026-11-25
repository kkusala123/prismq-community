FROM node:22-alpine AS builder
WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com
COPY package.json ./
RUN node -e "const fs=require('fs'),p=JSON.parse(fs.readFileSync('package.json','utf8')); for(const k of ['@electric-sql/pglite','vitest','supertest','@types/supertest','concurrently','tsx']) delete p.devDependencies[k]; fs.writeFileSync('package.json',JSON.stringify(p,null,2));" \
 && npm install

COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN npm config set registry https://registry.npmmirror.com
COPY package.json ./
RUN node -e "const fs=require('fs'),p=JSON.parse(fs.readFileSync('package.json','utf8')); delete p.devDependencies; fs.writeFileSync('package.json',JSON.stringify(p,null,2));" \
 && npm install --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "dist/server/index.js"]
