# TokTickIT

Full-stack app with a React + Vite client and an Express + Prisma server backed by PostgreSQL.

## Prerequisites

- Node.js 20+
- Docker (for local PostgreSQL)

## Setup

### 1. Database

```bash
cd server
cp .env.example .env
npm install
npm run db:start   # starts PostgreSQL via docker-compose
npm run db:push     # applies the Prisma schema
```

### 2. Server

```bash
cd server
npm run dev          # starts the API on http://localhost:3000
npm test             # runs the Vitest + Supertest suite
```

### 3. Client

```bash
cd client
npm install
npm run dev           # starts the app on http://localhost:5173
npm test              # runs the Vitest suite
```

## Project structure

```
client/   React + TypeScript + Vite frontend
server/   Express + TypeScript + Prisma backend
docs/     Lab notes and reference material
```
