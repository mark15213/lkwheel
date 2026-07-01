import { Server, type Socket } from "socket.io";
import {
  createRoom,
  exportResults,
  forceComplete,
  GameError,
  joinRoom,
  kickPlayer,
  revealRound,
  roomToView,
  setPlayerConnected,
  startGame,
  startNextRound,
  submitBid,
  updateLayout,
  type GameRoomState
} from "./game";
import { ROUND_DURATION_MS, type Seat } from "../shared/types";

type AckPayload<T extends object = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

type Ack<T extends object = Record<string, never>> = (payload: AckPayload<T>) => void;

const rooms = new Map<string, GameRoomState>();
const revealTimers = new Map<string, NodeJS.Timeout>();

export function registerRealtimeHandlers(io: Server): void {
  io.on("connection", (socket) => {
    socket.data.clientId = getClientId(socket);

    socket.on("room:create", (payload: unknown, ack?: Ack<{ code: string; room: ReturnType<typeof roomToView> }>) => {
      respond(ack, () => {
        const code = createRoomCode();
        const room = createRoom(code, socket.data.clientId);
        rooms.set(code, room);
        socket.join(code);
        return { code, room: roomToView(room) };
      });
    });

    socket.on("room:resume", (payload: { code?: string }, ack?: Ack<{ role: "host" | "player"; room: ReturnType<typeof roomToView> }>) => {
      respond(ack, () => {
        const room = getRoom(payload?.code);
        const clientId = socket.data.clientId;
        if (room.hostId === clientId) {
          socket.join(room.code);
          return { role: "host", room: roomToView(room) };
        }
        if (!room.players.has(clientId)) {
          throw new GameError("没有找到你的房间身份");
        }
        setPlayerConnected(room, clientId, true);
        socket.join(room.code);
        emitRoom(io, room);
        return { role: "player", room: roomToView(room) };
      });
    });

    socket.on("room:join", (payload: { code?: string; nickname?: string }, ack?: Ack<{ room: ReturnType<typeof roomToView> }>) => {
      respond(ack, () => {
        const room = getRoom(payload?.code);
        joinRoom(room, socket.data.clientId, String(payload?.nickname ?? ""));
        socket.join(room.code);
        emitRoom(io, room);
        return { room: roomToView(room) };
      });
    });

    socket.on("room:kick", (payload: { code?: string; playerId?: string }, ack?: Ack) => {
      respond(ack, () => {
        const room = getRoom(payload?.code);
        kickPlayer(room, socket.data.clientId, String(payload?.playerId ?? ""));
        emitRoom(io, room);
        return {};
      });
    });

    socket.on("layout:update", (payload: { code?: string; seats?: Seat[] }, ack?: Ack) => {
      respond(ack, () => {
        const room = getRoom(payload?.code);
        updateLayout(room, socket.data.clientId, Array.isArray(payload?.seats) ? payload.seats : []);
        emitRoom(io, room);
        return {};
      });
    });

    socket.on("game:start", (payload: { code?: string }, ack?: Ack) => {
      respond(ack, () => {
        const room = getRoom(payload?.code);
        startGame(room, socket.data.clientId);
        scheduleReveal(io, room);
        emitRoom(io, room);
        return {};
      });
    });

    socket.on("round:start", (payload: { code?: string }, ack?: Ack) => {
      respond(ack, () => {
        const room = getRoom(payload?.code);
        startNextRound(room, socket.data.clientId);
        scheduleReveal(io, room);
        emitRoom(io, room);
        return {};
      });
    });

    socket.on("bid:submit", (payload: { code?: string; seatId?: string; amount?: number }, ack?: Ack) => {
      respond(ack, () => {
        const room = getRoom(payload?.code);
        submitBid(room, socket.data.clientId, payload?.seatId as never, Number(payload?.amount));
        emitRoom(io, room);
        if (room.bids.size >= room.players.size - assignedPlayerCount(room)) {
          revealAndEmit(io, room);
        }
        return {};
      });
    });

    socket.on("round:reveal", (payload: { code?: string }, ack?: Ack) => {
      respond(ack, () => {
        const room = getRoom(payload?.code);
        assertHostSocket(room, socket);
        revealAndEmit(io, room);
        return {};
      });
    });

    socket.on("game:complete", (payload: { code?: string }, ack?: Ack) => {
      respond(ack, () => {
        const room = getRoom(payload?.code);
        forceComplete(room, socket.data.clientId);
        clearRevealTimer(room.code);
        emitRoom(io, room);
        return {};
      });
    });

    socket.on("result:export", (payload: { code?: string }, ack?: Ack<{ text: string; csv: string }>) => {
      respond(ack, () => {
        const room = getRoom(payload?.code);
        return exportResults(room);
      });
    });

    socket.on("disconnect", () => {
      for (const room of rooms.values()) {
        if (setPlayerConnected(room, socket.data.clientId, false)) {
          emitRoom(io, room);
        }
      }
    });
  });
}

function respond<T extends object>(ack: Ack<T> | undefined, handler: () => T): void {
  try {
    const payload = handler();
    ack?.({ ok: true, ...payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    ack?.({ ok: false, error: message });
  }
}

function getRoom(rawCode: string | undefined): GameRoomState {
  const code = String(rawCode ?? "").trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    throw new GameError("房间不存在");
  }
  return room;
}

function getClientId(socket: Socket): string {
  const authId = socket.handshake.auth?.clientId;
  const id = typeof authId === "string" && authId.trim() ? authId.trim() : socket.id;
  return id.slice(0, 80);
}

function createRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function emitRoom(io: Server, room: GameRoomState): void {
  io.to(room.code).emit("room:update", roomToView(room));
}

function scheduleReveal(io: Server, room: GameRoomState): void {
  clearRevealTimer(room.code);
  if (room.phase !== "round_open" || !room.roundEndsAt) {
    return;
  }

  const delay = Math.max(0, room.roundEndsAt - Date.now());
  revealTimers.set(
    room.code,
    setTimeout(() => {
      if (room.phase === "round_open") {
        revealAndEmit(io, room);
      }
    }, Math.min(delay, ROUND_DURATION_MS))
  );
}

function clearRevealTimer(code: string): void {
  const timer = revealTimers.get(code);
  if (timer) {
    clearTimeout(timer);
    revealTimers.delete(code);
  }
}

function revealAndEmit(io: Server, room: GameRoomState): void {
  clearRevealTimer(room.code);
  revealRound(room);
  emitRoom(io, room);
}

function assignedPlayerCount(room: GameRoomState): number {
  return Array.from(room.players.values()).filter((player) => player.seatId).length;
}

function assertHostSocket(room: GameRoomState, socket: Socket): void {
  if (room.hostId !== socket.data.clientId) {
    throw new GameError("只有主持人可以操作");
  }
}
