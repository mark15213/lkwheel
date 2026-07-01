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
import type { RoomView, Seat } from "../shared/types";

type HttpAck<T extends object = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export type RealtimeEvent =
  | "room:create"
  | "room:resume"
  | "room:join"
  | "room:kick"
  | "layout:update"
  | "game:start"
  | "round:start"
  | "bid:submit"
  | "round:reveal"
  | "game:complete"
  | "result:export";

const rooms = new Map<string, GameRoomState>();

export function handleHttpRealtimeEvent(
  event: RealtimeEvent,
  payload: Record<string, unknown>,
  rawClientId: string
): HttpAck<Record<string, unknown>> {
  try {
    const clientId = normalizeClientId(rawClientId);

    switch (event) {
      case "room:create": {
        const code = createRoomCode();
        const room = createRoom(code, clientId);
        rooms.set(code, room);
        return { ok: true, code, room: roomToView(room) };
      }

      case "room:resume": {
        const room = getRoom(payload.code);
        refreshRoom(room);
        if (room.hostId === clientId) {
          return { ok: true, role: "host", room: roomToView(room) };
        }
        if (!room.players.has(clientId)) {
          throw new GameError("没有找到你的房间身份");
        }
        setPlayerConnected(room, clientId, true);
        return { ok: true, role: "player", room: roomToView(room) };
      }

      case "room:join": {
        const room = getRoom(payload.code);
        refreshRoom(room);
        joinRoom(room, clientId, String(payload.nickname ?? ""));
        return { ok: true, room: roomToView(room) };
      }

      case "room:kick": {
        const room = getRoom(payload.code);
        refreshRoom(room);
        kickPlayer(room, clientId, String(payload.playerId ?? ""));
        return { ok: true, room: roomToView(room) };
      }

      case "layout:update": {
        const room = getRoom(payload.code);
        refreshRoom(room);
        updateLayout(room, clientId, Array.isArray(payload.seats) ? (payload.seats as Seat[]) : []);
        return { ok: true, room: roomToView(room) };
      }

      case "game:start": {
        const room = getRoom(payload.code);
        refreshRoom(room);
        startGame(room, clientId);
        return { ok: true, room: roomToView(room) };
      }

      case "round:start": {
        const room = getRoom(payload.code);
        refreshRoom(room);
        startNextRound(room, clientId);
        return { ok: true, room: roomToView(room) };
      }

      case "bid:submit": {
        const room = getRoom(payload.code);
        refreshRoom(room);
        submitBid(room, clientId, payload.seatId as never, Number(payload.amount));
        if (room.phase === "round_open" && room.bids.size >= room.players.size - assignedPlayerCount(room)) {
          revealRound(room);
        }
        return { ok: true, room: roomToView(room) };
      }

      case "round:reveal": {
        const room = getRoom(payload.code);
        assertHost(room, clientId);
        refreshRoom(room);
        if (room.phase === "round_open") {
          revealRound(room);
        }
        return { ok: true, room: roomToView(room) };
      }

      case "game:complete": {
        const room = getRoom(payload.code);
        forceComplete(room, clientId);
        return { ok: true, room: roomToView(room) };
      }

      case "result:export": {
        const room = getRoom(payload.code);
        refreshRoom(room);
        return { ok: true, ...exportResults(room), room: roomToView(room) };
      }

      default:
        throw new GameError("未知操作");
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "操作失败" };
  }
}

export function getHttpRealtimeRoom(rawCode: unknown, rawClientId: string): HttpAck<{ role?: "host" | "player"; room: RoomView }> {
  try {
    const clientId = normalizeClientId(rawClientId);
    const room = getRoom(rawCode);
    refreshRoom(room);
    let role: "host" | "player" | undefined;
    if (room.hostId === clientId) {
      role = "host";
    } else if (room.players.has(clientId)) {
      role = "player";
      setPlayerConnected(room, clientId, true);
    }
    return { ok: true, role, room: roomToView(room) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "操作失败" };
  }
}

export function getHttpRealtimeHealth(): HttpAck<{ transport: "http-polling" }> {
  return { ok: true, transport: "http-polling" };
}

function refreshRoom(room: GameRoomState): void {
  if (room.phase === "round_open" && room.roundEndsAt && room.roundEndsAt <= Date.now()) {
    revealRound(room);
  }
}

function assignedPlayerCount(room: GameRoomState): number {
  return Array.from(room.players.values()).filter((player) => player.seatId).length;
}

function getRoom(rawCode: unknown): GameRoomState {
  const code = String(rawCode ?? "").trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    throw new GameError("房间不存在");
  }
  return room;
}

function assertHost(room: GameRoomState, clientId: string): void {
  if (room.hostId !== clientId) {
    throw new GameError("只有主持人可以操作");
  }
}

function normalizeClientId(rawClientId: string): string {
  const id = String(rawClientId ?? "").trim();
  if (!id) {
    throw new GameError("缺少客户端身份");
  }
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
