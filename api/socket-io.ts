import { createServer } from "node:http";
import { Server } from "socket.io";
import { registerRealtimeHandlers } from "../server/realtime";

const httpServer = createServer();
const io = new Server(httpServer, {
  path: "/api/socket-io/socket.io",
  transports: ["websocket"],
  cors: {
    origin: true
  }
});

registerRealtimeHandlers(io);

export default httpServer;
