FROM oven/bun:1.3.2

WORKDIR /app

COPY package.json bun.lock turbo.json ./

COPY apps/backend/package.json ./apps/backend/package.json

RUN bun install

COPY apps/backend ./apps/backend

RUN cd apps/backend && bunx prisma generate

EXPOSE 3000

CMD ["sh", "-c", "cd apps/backend && bunx prisma migrate deploy && bun run index.ts"]
