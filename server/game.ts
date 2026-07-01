import {
  INITIAL_BALANCE,
  MAX_ROUNDS,
  MIN_PLAYERS_TO_START,
  ROUND_DURATION_MS,
  SEAT_IDS,
  type AutoAssignment,
  type Bid,
  type ExportResult,
  type PenaltyResult,
  type Phase,
  type Player,
  type RoomView,
  type RoundOutcome,
  type Seat,
  type SeatId,
  type WinnerResult
} from "../shared/types";

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameError";
  }
}

export interface GameRoomState {
  code: string;
  hostId: string;
  seats: Seat[];
  players: Map<string, Player>;
  phase: Phase;
  round: number;
  roundEndsAt?: number;
  latestOutcome?: RoundOutcome;
  bids: Map<string, Bid>;
  createdAt: number;
}

export function createRoom(code: string, hostId: string): GameRoomState {
  return {
    code,
    hostId,
    seats: createInitialSeats(),
    players: new Map(),
    phase: "lobby",
    round: 0,
    bids: new Map(),
    createdAt: Date.now()
  };
}

export function createInitialSeats(): Seat[] {
  return SEAT_IDS.map((id, index) => {
    const columns = 7;
    const row = Math.floor(index / columns);
    const col = index % columns;

    return {
      id,
      x: 10 + col * 13.3,
      y: row === 0 ? 34 : 66
    };
  });
}

export function joinRoom(room: GameRoomState, playerId: string, rawNickname: string): Player {
  const nickname = normalizeNickname(rawNickname);
  const existingPlayer = room.players.get(playerId);

  if (existingPlayer) {
    existingPlayer.connected = true;
    if (existingPlayer.nickname !== nickname && room.phase !== "lobby" && room.phase !== "layout") {
      throw new GameError("游戏开始后不能更换昵称");
    }
    existingPlayer.nickname = nickname;
    return existingPlayer;
  }

  if (room.phase !== "lobby" && room.phase !== "layout") {
    throw new GameError("游戏已经开始，不能加入新玩家");
  }

  if (room.players.size >= room.seats.length) {
    throw new GameError(`房间已满，最多${room.seats.length}名玩家`);
  }

  const duplicate = Array.from(room.players.values()).some(
    (player) => player.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase()
  );
  if (duplicate) {
    throw new GameError("昵称已被使用，请换一个");
  }

  const player: Player = {
    id: playerId,
    nickname,
    balance: INITIAL_BALANCE,
    connected: true
  };

  room.players.set(playerId, player);
  room.phase = "layout";
  return player;
}

export function setPlayerConnected(room: GameRoomState, playerId: string, connected: boolean): boolean {
  const player = room.players.get(playerId);
  if (!player) {
    return false;
  }

  player.connected = connected;
  return true;
}

export function kickPlayer(room: GameRoomState, hostId: string, playerId: string): void {
  assertHost(room, hostId);
  if (room.phase !== "lobby" && room.phase !== "layout") {
    throw new GameError("游戏开始后不能踢出玩家");
  }

  if (!room.players.has(playerId)) {
    throw new GameError("找不到这名玩家");
  }

  room.players.delete(playerId);
  room.bids.delete(playerId);
  for (const seat of room.seats) {
    if (seat.assignedTo === playerId) {
      delete seat.assignedTo;
    }
  }
}

export function updateLayout(room: GameRoomState, hostId: string, seats: Seat[]): void {
  assertHost(room, hostId);
  if (room.phase !== "lobby" && room.phase !== "layout") {
    throw new GameError("游戏开始后不能调整工位布局");
  }

  if (seats.length !== SEAT_IDS.length) {
    throw new GameError("工位数量不正确");
  }

  const knownSeats = new Set(SEAT_IDS);
  const seenSeats = new Set<string>();
  room.seats = seats.map((seat) => {
    if (!knownSeats.has(seat.id)) {
      throw new GameError("包含未知工位");
    }
    if (seenSeats.has(seat.id)) {
      throw new GameError("工位重复");
    }
    seenSeats.add(seat.id);

    const currentSeat = room.seats.find((item) => item.id === seat.id);
    return {
      id: seat.id,
      x: clamp(Number(seat.x), 4, 96),
      y: clamp(Number(seat.y), 10, 90),
      assignedTo: currentSeat?.assignedTo
    };
  });
  room.phase = "layout";
}

export function startGame(room: GameRoomState, hostId: string, now = Date.now()): void {
  assertHost(room, hostId);
  if (room.players.size < MIN_PLAYERS_TO_START) {
    throw new GameError("至少需要1名玩家才能开始");
  }
  if (room.players.size > room.seats.length) {
    throw new GameError(`当前玩家数超过工位数，最多${room.seats.length}人`);
  }
  if (room.phase !== "lobby" && room.phase !== "layout") {
    throw new GameError("游戏已经开始");
  }

  room.round = 1;
  room.phase = "round_open";
  room.roundEndsAt = now + ROUND_DURATION_MS;
  room.bids.clear();
  room.latestOutcome = undefined;
}

export function startNextRound(room: GameRoomState, hostId: string, now = Date.now()): void {
  assertHost(room, hostId);
  if (room.phase !== "reveal") {
    throw new GameError("当前不能开启下一轮");
  }
  if (room.round >= MAX_ROUNDS) {
    finalizeRemainingPlayers(room);
    return;
  }
  if (unassignedPlayers(room).length === 0) {
    room.phase = "complete";
    room.roundEndsAt = undefined;
    return;
  }

  room.round += 1;
  room.phase = "round_open";
  room.roundEndsAt = now + ROUND_DURATION_MS;
  room.bids.clear();
}

export function submitBid(
  room: GameRoomState,
  playerId: string,
  seatId: SeatId,
  amount: number,
  now = Date.now()
): Bid {
  if (room.phase !== "round_open") {
    throw new GameError("当前不在竞价时间");
  }

  const player = room.players.get(playerId);
  if (!player) {
    throw new GameError("你不在这个房间里");
  }
  if (player.seatId) {
    throw new GameError("你已经获得工位");
  }
  if (room.bids.has(playerId)) {
    throw new GameError("本轮已经提交，不能重复提交");
  }

  const seat = room.seats.find((item) => item.id === seatId);
  if (!seat) {
    throw new GameError("工位不存在");
  }
  if (seat.assignedTo) {
    throw new GameError("这个工位已经被抢走了");
  }

  const bidAmount = Math.floor(Number(amount));
  if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
    throw new GameError("出价必须大于0");
  }
  if (bidAmount > player.balance) {
    throw new GameError("工位币余额不足");
  }

  const bid: Bid = {
    playerId,
    seatId,
    amount: bidAmount,
    round: room.round,
    submittedAt: now
  };
  room.bids.set(playerId, bid);
  return bid;
}

export function revealRound(room: GameRoomState, rng: () => number = Math.random): RoundOutcome {
  if (room.phase !== "round_open") {
    throw new GameError("当前没有可揭晓的竞价");
  }

  const bidsBySeat = new Map<SeatId, Bid[]>();
  for (const bid of room.bids.values()) {
    const player = room.players.get(bid.playerId);
    const seat = room.seats.find((item) => item.id === bid.seatId);
    if (!player || player.seatId || !seat || seat.assignedTo) {
      continue;
    }

    const group = bidsBySeat.get(bid.seatId) ?? [];
    group.push(bid);
    bidsBySeat.set(bid.seatId, group);
  }

  const winners: WinnerResult[] = [];
  const penalties: PenaltyResult[] = [];

  for (const [seatId, seatBids] of bidsBySeat.entries()) {
    const sortedBids = [...seatBids].sort((left, right) => right.amount - left.amount);
    const topAmount = sortedBids[0]?.amount ?? 0;
    const topBids = sortedBids.filter((bid) => bid.amount === topAmount);
    const winnerBid = topBids[Math.floor(rng() * topBids.length)] ?? topBids[0];
    const winner = room.players.get(winnerBid.playerId);
    const seat = room.seats.find((item) => item.id === seatId);

    if (!winner || !seat) {
      continue;
    }

    winner.balance -= winnerBid.amount;
    winner.seatId = seatId;
    seat.assignedTo = winner.id;
    winners.push({
      seatId,
      playerId: winner.id,
      nickname: winner.nickname,
      amount: winnerBid.amount,
      tiedPlayerIds: topBids.map((bid) => bid.playerId)
    });

    for (const losingBid of sortedBids) {
      if (losingBid.playerId === winnerBid.playerId) {
        continue;
      }

      const losingPlayer = room.players.get(losingBid.playerId);
      if (!losingPlayer || losingPlayer.seatId) {
        continue;
      }

      const penalty = Math.min(losingPlayer.balance, Math.max(1, Math.ceil(losingBid.amount * 0.1)));
      losingPlayer.balance -= penalty;
      penalties.push({
        playerId: losingPlayer.id,
        nickname: losingPlayer.nickname,
        seatId,
        bidAmount: losingBid.amount,
        penalty
      });
    }
  }

  room.bids.clear();
  room.roundEndsAt = undefined;

  const autoAssignments =
    unassignedPlayers(room).length > 0 && room.round >= MAX_ROUNDS ? finalizeRemainingPlayers(room) : [];

  const completed = unassignedPlayers(room).length === 0;
  room.phase = completed ? "complete" : "reveal";

  const outcome: RoundOutcome = {
    round: room.round,
    winners,
    penalties,
    autoAssignments,
    completed
  };
  room.latestOutcome = outcome;
  return outcome;
}

export function forceComplete(room: GameRoomState, hostId: string): RoundOutcome {
  assertHost(room, hostId);
  const autoAssignments = finalizeRemainingPlayers(room);
  const outcome: RoundOutcome = {
    round: room.round,
    winners: [],
    penalties: [],
    autoAssignments,
    completed: true
  };
  room.latestOutcome = outcome;
  room.phase = "complete";
  room.roundEndsAt = undefined;
  room.bids.clear();
  return outcome;
}

export function roomToView(room: GameRoomState): RoomView {
  const players = Array.from(room.players.values());
  return {
    code: room.code,
    hostId: room.hostId,
    seats: room.seats,
    players,
    phase: room.phase,
    round: room.round,
    roundEndsAt: room.roundEndsAt,
    latestOutcome: room.latestOutcome,
    bidCount: room.bids.size,
    submittedPlayerIds: Array.from(room.bids.keys()),
    unassignedCount: players.filter((player) => !player.seatId).length
  };
}

export function exportResults(room: GameRoomState): ExportResult {
  const rows = resultRows(room);
  const text = rows
    .map(({ seatId, nickname }) => `${seatId}: ${nickname || "未分配"}`)
    .join("\n");
  const csv = ["seat,nickname", ...rows.map(({ seatId, nickname }) => `${seatId},${escapeCsv(nickname)}`)].join("\n");

  return { text, csv };
}

export function resultRows(room: GameRoomState): Array<{ seatId: SeatId; nickname: string }> {
  const playerBySeat = new Map<SeatId, Player>();
  for (const player of room.players.values()) {
    if (player.seatId) {
      playerBySeat.set(player.seatId, player);
    }
  }

  return SEAT_IDS.map((seatId) => ({
    seatId,
    nickname: playerBySeat.get(seatId)?.nickname ?? ""
  }));
}

export function unassignedPlayers(room: GameRoomState): Player[] {
  return Array.from(room.players.values()).filter((player) => !player.seatId);
}

function finalizeRemainingPlayers(room: GameRoomState): AutoAssignment[] {
  const remainingPlayers = unassignedPlayers(room).sort((left, right) => {
    if (right.balance !== left.balance) {
      return right.balance - left.balance;
    }
    return left.nickname.localeCompare(right.nickname, "zh-CN");
  });
  const remainingSeats = room.seats
    .filter((seat) => !seat.assignedTo)
    .sort((left, right) => {
      if (left.y !== right.y) {
        return left.y - right.y;
      }
      return left.x - right.x;
    });

  const assignments: AutoAssignment[] = [];
  for (const player of remainingPlayers) {
    const seat = remainingSeats.shift();
    if (!seat) {
      break;
    }

    player.seatId = seat.id;
    seat.assignedTo = player.id;
    assignments.push({
      playerId: player.id,
      nickname: player.nickname,
      seatId: seat.id,
      balance: player.balance
    });
  }

  room.phase = "complete";
  room.roundEndsAt = undefined;
  room.bids.clear();
  return assignments;
}

function assertHost(room: GameRoomState, clientId: string): void {
  if (room.hostId !== clientId) {
    throw new GameError("只有主持人可以操作");
  }
}

function normalizeNickname(rawNickname: string): string {
  const nickname = rawNickname.trim().replace(/\s+/g, " ").slice(0, 16);
  if (!nickname) {
    throw new GameError("请输入昵称");
  }
  return nickname;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function escapeCsv(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}
