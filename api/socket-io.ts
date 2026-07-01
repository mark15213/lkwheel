import { createServer } from "node:http";
import { Server, type ServerOptions } from "socket.io";
import { registerRealtimeHandlers } from "../server/realtime";

const httpServer = createServer((request, response) => {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(
    JSON.stringify({
      ok: true,
      endpoint: "/api/socket-io",
      socketPaths: ["/api/socket-io", "/api/socket-io/socket.io", "/socket.io"]
    })
  );
});

const sharedOptions: Partial<ServerOptions> = {
  transports: ["websocket"],
  cors: {
    origin: true
  }
};

const apiPathIo = new Server(httpServer, {
  ...sharedOptions,
  path: "/api/socket-io"
});
const defaultPathIo = new Server(httpServer, sharedOptions);
const fullPathIo = new Server(httpServer, {
  ...sharedOptions,
  path: "/api/socket-io/socket.io"
});

registerRealtimeHandlers(apiPathIo);
registerRealtimeHandlers(defaultPathIo);
registerRealtimeHandlers(fullPathIo);

export default httpServer;
