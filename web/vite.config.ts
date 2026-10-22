import { type Plugin, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** dev: the API this server stands in front of, so the app and its session cookie are one origin */
const api = process.env["AMUSE_API"];
const routes = ["/files", "/thumb", "/browser-view", "/pair", "/transcribe", "/unlock", "/setup", "/lock", "/password", "/connected"];
const proxy = api
  ? {
      ...Object.fromEntries(["/rpc", "/live", "/terminal"].map((path) => [path, { target: api, ws: true }])),
      ...Object.fromEntries(routes.map((path) => [path, { target: api }])),
    }
  : undefined;

/**
 * noVNC tests H.264 decoding when it loads, awaiting a test decode at the top
 * of a module; on some phones (Chrome on Android, with its hardware decoder)
 * that decode never finishes, and the whole app waited with it, blank, with no
 * error. The live view does not use H.264, so the test is not made. If noVNC
 * moves that line, the build says so rather than let the wait come back.
 */
const LINE = "supportsWebCodecsH264Decode = await _checkWebCodecsH264DecodeSupport();";
const noH264Test = {
  name: "novnc-no-h264-test",
  transform(code: string, id: string) {
    if (!id.includes("@novnc/novnc/core/util/browser.js")) return null;
    if (!code.includes(LINE)) throw new Error("noVNC changed: the H.264 test to leave out is not where it was (web/vite.config.ts)");
    return code.replace(LINE, "supportsWebCodecsH264Decode = false;");
  },
} satisfies Plugin;

export default defineConfig({
  plugins: [react(), tailwindcss(), noH264Test],
  server: { port: 5183, ...(proxy ? { proxy } : {}) },
  // noVNC uses top-level await
  build: { target: "es2022" },
  esbuild: { target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
