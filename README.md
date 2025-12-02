# Appwit - Turborepo Monorepo

A monorepo powered by Turborepo and Bun, containing the Appwit backend and frontend applications.

## Structure

```
appwit/
├── apps/
│   ├── backend/          # Express API (Bun runtime)
│   └── frontend/         # Next.js application
├── packages/             # Shared packages (if any)
├── turbo.json           # Turborepo configuration
└── package.json         # Root workspace configuration
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.1.38 or higher

### Installation

Install dependencies for all workspaces:

```bash
bun install
```

### Development

Run all apps in development mode:

```bash
bun run dev
```

Run specific workspace:

```bash
bun run dev --filter=@appwit/backend
bun run dev --filter=@appwit/frontend
```

### Building

Build all apps:

```bash
bun run build
```

Build specific workspace:

```bash
bun run build --filter=@appwit/backend
bun run build --filter=@appwit/frontend
```

### Linting

```bash
bun run lint
```

### Clean

Remove build artifacts:

```bash
bun run clean
```

## Workspaces

- **@appwit/backend** - Backend API server
- **@appwit/frontend** - Frontend Next.js application

## Turborepo Features

- **Build Caching**: Turborepo caches build outputs to speed up subsequent builds
- **Task Orchestration**: Automatically runs tasks in the correct order based on dependencies
- **Parallel Execution**: Runs independent tasks in parallel for faster builds

## Environment Variables

Each app has its own `.env` file. See the respective app directories for environment configuration details:

- `apps/backend/.env.example`
- `apps/frontend/.env.example`

## Learn More

- [Turborepo Documentation](https://turbo.build/repo/docs)
- [Bun Documentation](https://bun.sh/docs)
