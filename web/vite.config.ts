import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5183 },
  // noVNC uses top-level await
  build: { target: "es2022" },
  esbuild: { target: "es2022" },
});
