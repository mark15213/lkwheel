import express from "express";
import { createServer as createHttpServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { getHttpRealtimeHealth, getHttpRealtimeRoom, handleHttpRealtimeEvent, type RealtimeEvent } from "./httpRealtime";
import { registerRealtimeHandlers } from "./realtime";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const httpServer = createHttpServer(app);
const io = new Server(httpServer);
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST?.trim();

registerRealtimeHandlers(io);

app.use(express.json({ limit: "128kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/realtime", (request, response) => {
  const code = String(request.query.code ?? "");
  if (!code) {
    response.json(getHttpRealtimeHealth());
    return;
  }
  response.json(getHttpRealtimeRoom(code, getClientIdFromRequest(request)));
});

app.post("/api/realtime", (request, response) => {
  const body = (request.body ?? {}) as {
    event?: string;
    payload?: Record<string, unknown>;
    clientId?: string;
  };
  response.json(
    handleHttpRealtimeEvent(
      String(body.event ?? "") as RealtimeEvent,
      body.payload && typeof body.payload === "object" ? body.payload : {},
      getClientIdFromRequest(request, body.clientId)
    )
  );
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

if (host) {
  httpServer.listen(port, host, logStartup);
} else {
  httpServer.listen(port, logStartup);
}

function getClientIdFromRequest(request: express.Request, fallback?: unknown): string {
  const headerValue = request.header("x-client-id");
  return headerValue?.trim() || String(fallback ?? "");
}

function logStartup(): void {
  console.log(`Desk auction room listening on http://localhost:${port}`);
  if (host === "0.0.0.0" || host === "::") {
    for (const address of getLocalIPv4Addresses()) {
      console.log(`LAN address: http://${address}:${port}`);
    }
  }
}

function getLocalIPv4Addresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}
