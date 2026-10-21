import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** dev: the API this server stands in front of, so the app and its session cookie are one origin */
const api = process.env["AMUSE_API"];
const routes = ["/files", "/thumb", "/unlock", "/setup", "/lock", "/password", "/connected"];
const proxy = api
  ? {
      ...Object.fromEntries(["/rpc", "/live"].map((path) => [path, { target: api, ws: true }])),
      ...Object.fromEntries(routes.map((path) => [path, { target: api }])),
    }
  : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5183, ...(proxy ? { proxy } : {}) },
  // noVNC uses top-level await
  build: { target: "es2022" },
  esbuild: { target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
