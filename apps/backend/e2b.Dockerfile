FROM e2bdev/code-interpreter:latest 

# Set working directory
WORKDIR /home/user

# Install s3fs for R2 bucket mounting
RUN apt-get update && apt-get install -y s3fs && rm -rf /var/lib/apt/lists/*

# Install Vite (React TypeScript template)
RUN npm create vite@latest . -- --template react-ts && \
    npm install

RUN echo "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()],\n  server: {\n    host: true, allowedHosts: true }\n})" > vite.config.ts
