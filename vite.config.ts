import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/** Opens the connection to the API while the page's own scripts are still downloading. */
function preconnect(apiBase: string): Plugin {
  return {
    name: "preconnect-api",
    transformIndexHtml() {
      try {
        const origin = new URL(apiBase).origin;
        return [{ tag: "link", attrs: { rel: "preconnect", href: origin, crossorigin: "" }, injectTo: "head-prepend" }];
      } catch {
        return [];
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // SAME-DOMAIN API. On Vercel the browser calls "/api" on the website's own address and
  // vercel.json forwards it to the Render API, so sign-in cookies are first-party and work in
  // every browser (Safari included). The live-update stream is long-lived and carries no
  // sign-in, so it connects to the API directly (VITE_STREAM_BASE_URL).
  const onVercel = process.env.VERCEL === "1" && env.VITE_DIRECT_API !== "true";
  const directApi = env.VITE_API_BASE_URL?.startsWith("http") ? env.VITE_API_BASE_URL : "http://localhost:3001/api";

  return {
    define: onVercel
      ? { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("/api"), "import.meta.env.VITE_STREAM_BASE_URL": JSON.stringify(env.VITE_STREAM_BASE_URL || directApi) }
      : {},
    plugins: [react(), preconnect(onVercel ? env.VITE_STREAM_BASE_URL || directApi : directApi)],
    resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
    server: { port: 5173 },
    build: {
      target: "es2019",
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          // React and the router rarely change: returning visitors keep them cached across deploys.
          manualChunks: { vendor: ["react", "react-dom", "react-router-dom"] },
          // Hashed names only, so the public site's files don't list the names of workspace screens.
          chunkFileNames: "assets/[hash].js",
          assetFileNames: "assets/[hash][extname]",
        },
      },
    },
    test: { environment: "node", include: ["src/**/*.test.ts"] },
  };
});
