export const SEAT_IDS = [
  "200S",
  "201S",
  "145S",
  "148S",
  "141S",
  "144S",
  "147S",
  "202S",
  "203S",
  "128S",
  "134S",
  "140S",
  "143S",
  "146S"
] as const;

export type SeatId = (typeof SEAT_IDS)[number];
export type Phase = "lobby" | "layout" | "round_open" | "reveal" | "complete";

export const INITIAL_BALANCE = 100;
export const ROOM_CAPACITY = SEAT_IDS.length;
export const MIN_PLAYERS_TO_START = 1;
export const MAX_ROUNDS = 5;
export const ROUND_DURATION_MS = 60_000;

export interface Seat {
  id: SeatId;
  x: number;
  y: number;
  assignedTo?: string;
}

export interface Player {
  id: string;
  nickname: string;
  balance: number;
  seatId?: SeatId;
  connected: boolean;
}

export interface Bid {
  playerId: string;
  seatId: SeatId;
  amount: number;
  round: number;
  submittedAt: number;
}

export interface WinnerResult {
  seatId: SeatId;
  playerId: string;
  nickname: string;
  amount: number;
  tiedPlayerIds: string[];
}

export interface PenaltyResult {
  playerId: string;
  nickname: string;
  seatId: SeatId;
  bidAmount: number;
  penalty: number;
}

export interface AutoAssignment {
  playerId: string;
  nickname: string;
  seatId: SeatId;
  balance: number;
}

export interface RoundOutcome {
  round: number;
  winners: WinnerResult[];
  penalties: PenaltyResult[];
  autoAssignments: AutoAssignment[];
  completed: boolean;
}

export interface Room {
  code: string;
  hostId: string;
  seats: Seat[];
  players: Player[];
  phase: Phase;
  round: number;
  roundEndsAt?: number;
  latestOutcome?: RoundOutcome;
}

export interface RoomView extends Room {
  bidCount: number;
  submittedPlayerIds: string[];
  unassignedCount: number;
}

export interface ExportResult {
  text: string;
  csv: string;
}
