import express from "express";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { registerRealtimeHandlers } from "./realtime";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const httpServer = createHttpServer(app);
const io = new Server(httpServer);
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 5173);

registerRealtimeHandlers(io);

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

if (isProduction) {
  const distPath = path.resolve(__dirname, "../dist");
  app.use(express.static(distPath));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(distPath, "index.html"));
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

httpServer.listen(port, () => {
  console.log(`Desk auction room listening on http://localhost:${port}`);
});
