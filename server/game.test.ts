import assert from "node:assert/strict";
import test from "node:test";
import { ROOM_CAPACITY, SEAT_IDS } from "../shared/types";
import {
  createRoom,
  exportResults,
  forceComplete,
  joinRoom,
  revealRound,
  roomToView,
  startGame,
  startNextRound,
  submitBid
} from "./game";

test("starts with a non-empty room and rejects duplicate nicknames", () => {
  const room = createRoom("ROOM1", "host");

  joinRoom(room, "player-0", "玩家1");
  joinRoom(room, "player-1", "玩家2");

  assert.throws(() => joinRoom(room, "duplicate", "玩家1"), /昵称已被使用/);

  for (let index = 2; index < ROOM_CAPACITY; index += 1) {
    joinRoom(room, `player-${index}`, `玩家${index + 1}`);
  }

  assert.equal(room.players.size, ROOM_CAPACITY);
  assert.throws(() => joinRoom(room, "extra", "玩家15"), /房间已满/);

  startGame(room, "host", 1_000);
  assert.equal(room.phase, "round_open");
  assert.equal(room.round, 1);
  assert.equal(room.roundEndsAt, 61_000);
});

test("does not require every seat to have a player before starting", () => {
  const room = createRoom("ROOM1B", "host");

  joinRoom(room, "player-0", "玩家1");
  joinRoom(room, "player-1", "玩家2");
  joinRoom(room, "player-2", "玩家3");

  startGame(room, "host");
  assert.equal(room.phase, "round_open");
  assert.equal(room.players.size, 3);
});

test("validates bid submission", () => {
  const room = createRoom("ROOM2", "host");
  for (let index = 0; index < ROOM_CAPACITY; index += 1) {
    joinRoom(room, `player-${index}`, `玩家${index + 1}`);
  }
  startGame(room, "host");

  submitBid(room, "player-0", "200S", 30);
  assert.throws(() => submitBid(room, "player-0", "201S", 20), /已经提交/);
  assert.throws(() => submitBid(room, "player-1", "200S", 101), /余额不足/);
  assert.throws(() => submitBid(room, "player-1", "200S", 0), /必须大于0/);
});

test("awards one winner per seat and charges losing penalties", () => {
  const room = createRoom("ROOM3", "host");
  for (let index = 0; index < ROOM_CAPACITY; index += 1) {
    joinRoom(room, `player-${index}`, `玩家${index + 1}`);
  }
  startGame(room, "host");

  submitBid(room, "player-0", "200S", 60);
  submitBid(room, "player-1", "200S", 60);
  submitBid(room, "player-2", "201S", 25);

  const outcome = revealRound(room, () => 0);
  assert.equal(outcome.winners.length, 2);
  assert.equal(outcome.winners.find((winner) => winner.seatId === "200S")?.playerId, "player-0");
  assert.equal(room.players.get("player-0")?.seatId, "200S");
  assert.equal(room.players.get("player-0")?.balance, 40);
  assert.equal(room.players.get("player-1")?.balance, 94);
  assert.equal(room.players.get("player-2")?.seatId, "201S");
});

test("continues past five rounds and only auto-assigns when host completes", () => {
  const room = createRoom("ROOM4", "host");
  for (let index = 0; index < ROOM_CAPACITY; index += 1) {
    joinRoom(room, `player-${index}`, `玩家${String(index + 1).padStart(2, "0")}`);
  }
  startGame(room, "host");

  for (let round = 1; round <= 6; round += 1) {
    const bidderId = `player-${round - 1}`;
    submitBid(room, bidderId, SEAT_IDS[round - 1], 10 + round);
    revealRound(room, () => 0);
    if (round < 6) {
      startNextRound(room, "host");
    }
  }

  assert.equal(room.phase, "reveal");
  assert.equal(room.round, 6);
  assert.equal(roomToView(room).unassignedCount, ROOM_CAPACITY - 6);

  forceComplete(room, "host");
  assert.equal(room.phase, "complete");
  const view = roomToView(room);
  assert.equal(view.unassignedCount, 0);
  assert.equal(new Set(view.players.map((player) => player.seatId)).size, ROOM_CAPACITY);
});

test("exports final results as text and csv", () => {
  const room = createRoom("ROOM5", "host");
  for (let index = 0; index < ROOM_CAPACITY; index += 1) {
    joinRoom(room, `player-${index}`, `玩家${index + 1}`);
  }
  startGame(room, "host");
  for (let index = 0; index < ROOM_CAPACITY; index += 1) {
    submitBid(room, `player-${index}`, SEAT_IDS[index], 1);
  }
  revealRound(room, () => 0);

  const result = exportResults(room);
  assert.match(result.text, /200S: 玩家1/);
  assert.match(result.csv, /seat,nickname/);
});
