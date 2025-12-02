# Docker Setup Guide

This guide explains how to build and run the Appwit Turborepo using Docker.

## Prerequisites

- Docker (v20.10 or higher)
- Docker Compose (v2.0 or higher)

## Quick Start

### 1. Environment Setup

Copy the environment template:
```bash
cp .env.example .env
```

Edit `.env` and set your configuration values.

### 2. Build and Run

Build and start all services:
```bash
docker-compose up --build
```

Run in detached mode:
```bash
docker-compose up -d
```

### 3. Access Services

- **Frontend**: http://localhost:8080
- **Backend**: http://localhost:3000

## Individual Service Commands

### Build Specific Service
```bash
docker-compose build backend
docker-compose build frontend
```

### Run Specific Service
```bash
docker-compose up backend
docker-compose up frontend
```

### View Logs
```bash
docker-compose logs backend
docker-compose logs frontend
docker-compose logs -f  # Follow all logs
```

### Stop Services
```bash
docker-compose down
```

### Stop and Remove Volumes
```bash
docker-compose down -v
```

## Docker Files Structure

```
Appwit/
├── docker/
│   ├── backend.dockerfile    # Backend Dockerfile (Bun runtime)
│   └── frontend.dockerfile   # Frontend Dockerfile (Next.js)
├── docker-compose.yml         # Orchestration configuration
├── .dockerignore             # Files to exclude from builds
└── .env.example              # Environment template
```

## Dockerfile Details

### Backend (Bun)
- Base: `oven/bun:1.3.2`
- Runtime: Bun
- Port: 3000
- Command: `bun start:backend`

### Frontend (Next.js)
- Builder: `oven/bun:1.3.2`
- Runtime: `node:20-alpine`
- Port: 3000 (mapped to 8080 on host)
- Build: Standalone Next.js output
- Command: `node apps/frontend/server.js`

## Production Deployment

### Build Production Images
```bash
docker-compose build --no-cache
```

### Tag Images
```bash
docker tag appwit/backend:latest your-registry/appwit-backend:v1.0.0
docker tag appwit/frontend:latest your-registry/appwit-frontend:v1.0.0
```

### Push to Registry
```bash
docker push your-registry/appwit-backend:v1.0.0
docker push your-registry/appwit-frontend:v1.0.0
```

## Troubleshooting

### Container Fails to Start
1. Check logs: `docker-compose logs <service-name>`
2. Verify environment variables in `.env`
3. Ensure ports are not already in use

### Build Failures
1. Clear Docker cache: `docker system prune -a`
2. Rebuild: `docker-compose build --no-cache`

### Cannot Connect to Backend from Frontend
1. Verify both containers are on the same network
2. Check `NEXT_PUBLIC_API_URL` environment variable
3. Ensure backend health check is passing

## Health Checks

The backend service includes a health check that polls `/health` endpoint:
- Interval: 30s
- Timeout: 10s
- Retries: 3
- Start period: 40s

Verify health status:
```bash
docker-compose ps
```

## Environment Variables

Key environment variables (see `.env.example`):

- `NODE_ENV`: Application environment (production/development)
- `BACKEND_PORT`: Backend port (default: 3000)
- `FRONTEND_PORT`: Frontend port (default: 8080)
- `NEXT_PUBLIC_API_URL`: Backend API URL for frontend
- `BACKEND_IMAGE`: Backend Docker image tag
- `FRONTEND_IMAGE`: Frontend Docker image tag
