import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    cloudflare(),
  ],
  build: {
    minify: true,
    rolldownOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes("node_modules")) {
            return "vendor";
          }
          const match = id.match(/node_modules\/(.+)\/dist/);
          if (match) {
            const name = match[1];
            if (name) {
              return name;
            }
          }
          const match2 = id.match(/node_modules\/([^/]+)/);
          if (match2) {
            const name = match2[1];
            if (name) {
              return name;
            }
          }
        },
      },
    },
  },
});
