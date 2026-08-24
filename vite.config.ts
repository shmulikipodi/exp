import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Make .env.local visible to the API handler running inside the dev server.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  return {
    // Spotify rejects redirect URIs spelled "localhost" — it wants the literal
    // loopback IP, so the dev server has to answer on that exact host.
    server: { host: "127.0.0.1", port: 5174, strictPort: true },
    plugins: [
      react(),
      {
        // Runs api/notes.ts as middleware in dev, so `npm run dev` is enough —
        // no `vercel dev`, no project linking. In production Vercel serves it.
        name: "api-routes",
        configureServer(server) {
          server.middlewares.use("/api/notes", async (req, res, next) => {
            try {
              const mod = await server.ssrLoadModule("/api/notes.ts");
              await mod.default(req, res);
            } catch (err) {
              res.statusCode = 500;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: (err as Error).message }));
              next();
            }
          });
        },
      },
    ],
  };
});
