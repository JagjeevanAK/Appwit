FROM e2bdev/code-interpreter:latest 

# Set working directory
WORKDIR /home/user

# Install s3fs for R2 bucket mounting
RUN sudo apt-get update && sudo apt-get install -y s3fs && sudo rm -rf /var/lib/apt/lists/*

# Install Vite (React TypeScript template)
RUN cd /tmp && \
    npx -y create-vite@5.5.0 vite-app --template react-ts && \
    cp -r /tmp/vite-app/* /home/user/ && \
    cp -r /tmp/vite-app/.[!.]* /home/user/ 2>/dev/null || true && \
    rm -rf /tmp/vite-app && \
    cd /home/user && npm install

# Install Tailwind CSS with Vite plugin
RUN npm install tailwindcss @tailwindcss/vite

# Configure Vite with React and Tailwind plugins
RUN echo "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nimport tailwindcss from '@tailwindcss/vite'\n\nexport default defineConfig({\n  plugins: [react(), tailwindcss()],\n  server: {\n    host: true, allowedHosts: true }\n})" > vite.config.ts

# Configure CSS to use Tailwind
RUN echo '@import "tailwindcss";' > src/index.css
