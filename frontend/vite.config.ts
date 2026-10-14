import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "path";

export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../public/dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        chunkFileNames: "assets/[name]-[hash]-.js",
        entryFileNames: "assets/[name]-[hash]-.js",
        assetFileNames: "assets/[name]-[hash]-.[ext]",
      },
    },
  },
});
