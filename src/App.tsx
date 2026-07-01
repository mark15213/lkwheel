import {
  Check,
  ClipboardList,
  Coins,
  Copy,
  Crown,
  Download,
  Eye,
  Gavel,
  LogIn,
  MapPinned,
  Move,
  Play,
  RefreshCw,
  Sparkles,
  TimerReset,
  Trophy,
  Users,
  Wifi,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import {
  INITIAL_BALANCE,
  SEAT_IDS,
  type Player,
  type RoomView,
  type Seat,
  type SeatId
} from "../shared/types";

type Role = "host" | "player" | null;
type Ack<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error: string };
type Session = { code: string; role: Exclude<Role, null>; nickname?: string };
type RealtimeClient = {
  emit: <T = Record<string, unknown>>(
    event: string,
    payload: Record<string, unknown>,
    ack?: (response: Ack<T>) => void
  ) => void;
  disconnect: () => void;
};

const SESSION_KEY = "desk-auction-session";
const CLIENT_KEY = "desk-auction-client-id";
const phaseLabel: Record<RoomView["phase"], string> = {
  lobby: "等待入场",
  layout: "排布工位",
  round_open: "暗拍中",
  reveal: "揭晓",
  complete: "完成"
};

export default function App() {
  const [socket, setSocket] = useState<RealtimeClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [joinCode, setJoinCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [hostPlayerName, setHostPlayerName] = useState("主持人");
  const [selectedSeat, setSelectedSeat] = useState<SeatId | "">("");
  const [bidAmount, setBidAmount] = useState(20);
  const [notice, setNotice] = useState("");
  const roomCodeRef = useRef("");
  const roleRef = useRef<Role>(null);

  const currentPlayer = useMemo(() => {
    if (!room) {
      return undefined;
    }
    return room.players.find((player) => player.id === getClientId());
  }, [room]);

  const unassignedSeats = useMemo(
    () => room?.seats.filter((seat) => !seat.assignedTo) ?? [],
    [room?.seats]
  );

  useEffect(() => {
    if (room?.code) {
      roomCodeRef.current = room.code;
    }
  }, [room?.code]);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    const socketPaths = getSocketPaths();
    const socketUrl = import.meta.env.VITE_SOCKET_URL || undefined;
    let activeClient: Socket | null = null;
    let activeFallback: RealtimeClient | null = null;
    let cancelled = false;
    let retryTimer: number | undefined;

    const clearRetry = () => {
      if (retryTimer) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    };

    const connectWithPath = (pathIndex: number) => {
      clearRetry();
      const socketPath = socketPaths[pathIndex];
      const client = io(socketUrl, {
        path: socketPath,
        transports: ["websocket"],
        reconnection: false,
        timeout: 2500,
        auth: {
          clientId: getClientId()
        }
      });

      activeClient = client;
      setSocket(wrapSocketClient(client));

      client.on("connect", () => {
        if (cancelled || client !== activeClient) {
          return;
        }
        setConnected(true);
        setNotice("");
        const saved = readSession();
        if (saved?.code) {
          client.emit(
            "room:resume",
            { code: saved.code },
            (response: Ack<{ role: "host" | "player"; room: RoomView }>) => {
              if (response.ok) {
                setRole(response.role);
                setRoom(response.room);
                setJoinCode(response.room.code);
                setNickname(saved.nickname ?? "");
              } else {
                localStorage.removeItem(SESSION_KEY);
              }
            }
          );
        }
      });

      client.on("disconnect", () => {
        if (cancelled || client !== activeClient) {
          return;
        }
        setConnected(false);
        retryTimer = window.setTimeout(() => connectWithPath(0), 1800);
      });

      client.on("connect_error", (error) => {
        if (cancelled || client !== activeClient) {
          return;
        }
        client.removeAllListeners();
        client.disconnect();
        const nextIndex = pathIndex + 1;
        if (nextIndex < socketPaths.length) {
          connectWithPath(nextIndex);
          return;
        }
        startHttpFallback(error.message);
      });

      client.on("room:update", (nextRoom: RoomView) => {
        if (!cancelled && client === activeClient) {
          setRoom(nextRoom);
        }
      });
    };

    const startHttpFallback = (lastError: string) => {
      if (cancelled || activeFallback) {
        return;
      }
      activeClient?.disconnect();
      activeFallback = createHttpRealtimeClient({
        getRoomCode: () => roomCodeRef.current || readSession()?.code || "",
        onConnectionChange: setConnected,
        onRoomUpdate: (nextRoom, nextRole) => {
          setRoom(nextRoom);
          setJoinCode(nextRoom.code);
          if (nextRole && !roleRef.current) {
            setRole(nextRole);
          }
        }
      });
      setSocket(activeFallback);
      setNotice(`WebSocket 连接失败，已切换兼容模式（${lastError}）`);

      const saved = readSession();
      if (saved?.code) {
        activeFallback.emit(
          "room:resume",
          { code: saved.code },
          (response: Ack<{ role: "host" | "player"; room: RoomView }>) => {
            if (response.ok) {
              setRole(response.role);
              setRoom(response.room);
              setJoinCode(response.room.code);
              setNickname(saved.nickname ?? "");
            } else {
              localStorage.removeItem(SESSION_KEY);
            }
          }
        );
      }
    };

    connectWithPath(0);

    return () => {
      cancelled = true;
      clearRetry();
      activeClient?.disconnect();
      activeFallback?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!currentPlayer) {
      return;
    }
    setBidAmount((value) => Math.min(Math.max(1, value), currentPlayer.balance));
  }, [currentPlayer?.balance]);

  function createRoom() {
    if (!socket) {
      return;
    }
    socket.emit("room:create", {}, (response: Ack<{ code: string; room: RoomView }>) => {
      if (!response.ok) {
        setNotice(response.error);
        return;
      }
      setRole("host");
      setRoom(response.room);
      setJoinCode(response.code);
      saveSession({ code: response.code, role: "host" });
      setNotice(`房间 ${response.code} 已创建`);
    });
  }

  function joinRoom() {
    if (!socket) {
      return;
    }
    socket.emit(
      "room:join",
      { code: joinCode.trim().toUpperCase(), nickname },
      (response: Ack<{ room: RoomView }>) => {
        if (!response.ok) {
          setNotice(response.error);
          return;
        }
        setRole("player");
        setRoom(response.room);
        saveSession({ code: response.room.code, role: "player", nickname });
        setNotice("入场成功");
      }
    );
  }

  function joinHostAsPlayer() {
    if (!socket || !room) {
      return;
    }
    socket.emit(
      "room:join",
      { code: room.code, nickname: hostPlayerName },
      (response: Ack<{ room: RoomView }>) => {
        if (!response.ok) {
          setNotice(response.error);
          return;
        }
        setRoom(response.room);
        saveSession({ code: response.room.code, role: "host", nickname: hostPlayerName });
        setNotice("主持人已加入玩家列表");
      }
    );
  }

  function hostAction(event: string, payload: Record<string, unknown> = {}, successMessage?: string) {
    if (!socket || !room) {
      return;
    }
    socket.emit(event, { code: room.code, ...payload }, (response: Ack) => {
      if (!response.ok) {
        setNotice(response.error);
        return;
      }
      if (successMessage) {
        setNotice(successMessage);
      }
    });
  }

  function updateLayout(seats: Seat[]) {
    if (!socket || !room) {
      return;
    }
    setRoom({ ...room, seats });
    socket.emit("layout:update", { code: room.code, seats }, (response: Ack) => {
      if (!response.ok) {
        setNotice(response.error);
      }
    });
  }

  function submitBid() {
    if (!socket || !room || !selectedSeat) {
      setNotice("先选择一个工位");
      return;
    }
    socket.emit(
      "bid:submit",
      { code: room.code, seatId: selectedSeat, amount: bidAmount },
      (response: Ack) => {
        if (!response.ok) {
          setNotice(response.error);
          return;
        }
        setNotice("暗拍已锁定");
      }
    );
  }

  function exportResult(format: "text" | "csv") {
    if (!socket || !room) {
      return;
    }
    socket.emit("result:export", { code: room.code }, async (response: Ack<{ text: string; csv: string }>) => {
      if (!response.ok) {
        setNotice(response.error);
        return;
      }
      if (format === "text") {
        await navigator.clipboard?.writeText(response.text);
        setNotice("结果已复制");
        return;
      }

      const blob = new Blob([response.csv], { type: "text/csv;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `desk-auction-${room.code}.csv`;
      link.click();
      URL.revokeObjectURL(href);
      setNotice("CSV 已下载");
    });
  }

  const hasSubmitted = Boolean(currentPlayer && room?.submittedPlayerIds.includes(currentPlayer.id));
  const canBid = room?.phase === "round_open" && currentPlayer && !currentPlayer.seatId && !hasSubmitted;
  const canDragLayout = role === "host" && (room?.phase === "lobby" || room?.phase === "layout");

  return (
    <main className="appShell">
      {notice && <div className="toast">{notice}</div>}
      <header className="topBar">
        <div className="brandLockup">
          <div className="brandMark">
            <Gavel size={22} />
          </div>
          <div>
            <h1>工位暗拍局</h1>
            <p>{room ? `房间 ${room.code}` : "在线暗拍抢工位"}</p>
          </div>
        </div>
        <div className="topStatus">
          <span className={`connection ${connected ? "online" : ""}`}>
            <Wifi size={16} />
            {connected ? "在线" : "离线"}
          </span>
          {room && <span className="phaseBadge">{phaseLabel[room.phase]}</span>}
        </div>
      </header>

      {!room ? (
        <EntryPanel
          joinCode={joinCode}
          nickname={nickname}
          setJoinCode={setJoinCode}
          setNickname={setNickname}
          createRoom={createRoom}
          joinRoom={joinRoom}
        />
      ) : (
        <div className="gameGrid">
          <section className="boardPanel">
            <div className="boardHeader">
              <div>
                <span className="eyebrow">
                  <MapPinned size={15} />
                  工位图
                </span>
                <h2>{room.phase === "complete" ? "最终座位" : `第 ${Math.max(room.round, 1)} 轮`}</h2>
              </div>
              {room.phase === "round_open" && <Countdown endsAt={room.roundEndsAt} />}
            </div>
            <SeatBoard
              seats={room.seats}
              players={room.players}
              draggable={canDragLayout}
              selectedSeat={selectedSeat}
              currentPlayerId={currentPlayer?.id}
              onSelectSeat={(seatId) => {
                if (canBid) {
                  setSelectedSeat(seatId);
                }
              }}
              onLayoutCommit={updateLayout}
            />
          </section>

          <aside className="sidePanel">
            {role === "host" ? (
              <HostPanel
                room={room}
                currentPlayer={currentPlayer}
                selectedSeat={selectedSeat}
                setSelectedSeat={setSelectedSeat}
                bidAmount={bidAmount}
                setBidAmount={setBidAmount}
                canBid={Boolean(canBid)}
                hasSubmitted={hasSubmitted}
                unassignedSeats={unassignedSeats}
                submitBid={submitBid}
                hostPlayerName={hostPlayerName}
                setHostPlayerName={setHostPlayerName}
                onJoinAsPlayer={joinHostAsPlayer}
                exportResult={exportResult}
                onKick={(playerId) => hostAction("room:kick", { playerId })}
                onStart={() => hostAction("game:start", {}, "暗拍开始")}
                onReveal={() => hostAction("round:reveal", {}, "本轮已揭晓")}
                onNextRound={() => hostAction("round:start", {}, "下一轮开始")}
                onComplete={() => hostAction("game:complete", {}, "游戏已收官")}
              />
            ) : (
              <PlayerPanel
                room={room}
                player={currentPlayer}
                selectedSeat={selectedSeat}
                setSelectedSeat={setSelectedSeat}
                bidAmount={bidAmount}
                setBidAmount={setBidAmount}
                canBid={Boolean(canBid)}
                hasSubmitted={hasSubmitted}
                unassignedSeats={unassignedSeats}
                submitBid={submitBid}
                exportResult={exportResult}
              />
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

function EntryPanel({
  joinCode,
  nickname,
  setJoinCode,
  setNickname,
  createRoom,
  joinRoom
}: {
  joinCode: string;
  nickname: string;
  setJoinCode: (value: string) => void;
  setNickname: (value: string) => void;
  createRoom: () => void;
  joinRoom: () => void;
}) {
  return (
    <section className="entryPanel">
      <div className="entryHero">
        <div className="auctionToken">
          <Crown size={44} />
          <span>100</span>
        </div>
        <h2>暗拍抢座，揭晓见分晓</h2>
        <div className="seatPreview">
          {SEAT_IDS.slice(0, 7).map((seatId) => (
            <span key={seatId}>{seatId}</span>
          ))}
        </div>
      </div>
      <div className="entryActions">
        <button className="primaryAction" type="button" onClick={createRoom}>
          <Crown size={19} />
          创建主持房间
        </button>
        <div className="joinBox">
          <label>
            房间码
            <input
              value={joinCode}
              maxLength={5}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              placeholder="ABCDE"
            />
          </label>
          <label>
            昵称
            <input
              value={nickname}
              maxLength={16}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="输入名字"
            />
          </label>
          <button type="button" className="secondaryAction" onClick={joinRoom}>
            <LogIn size={18} />
            加入游戏
          </button>
        </div>
        <RulesPanel embedded />
      </div>
    </section>
  );
}

function SeatBoard({
  seats,
  players,
  draggable,
  selectedSeat,
  currentPlayerId,
  onSelectSeat,
  onLayoutCommit
}: {
  seats: Seat[];
  players: Player[];
  draggable: boolean;
  selectedSeat: SeatId | "";
  currentPlayerId?: string;
  onSelectSeat: (seatId: SeatId) => void;
  onLayoutCommit: (seats: Seat[]) => void;
}) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [draftSeats, setDraftSeats] = useState(seats);
  const dragSeatId = useRef<SeatId | null>(null);

  useEffect(() => {
    setDraftSeats(seats);
  }, [seats]);

  function moveSeat(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragSeatId.current || !boardRef.current) {
      return;
    }
    const rect = boardRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const seatId = dragSeatId.current;
    setDraftSeats((current) =>
      current.map((seat) =>
        seat.id === seatId
          ? {
              ...seat,
              x: Math.min(96, Math.max(4, x)),
              y: Math.min(90, Math.max(10, y))
            }
          : seat
      )
    );
  }

  function endDrag() {
    if (!dragSeatId.current) {
      return;
    }
    dragSeatId.current = null;
    onLayoutCommit(draftSeats);
  }

  return (
    <div
      ref={boardRef}
      className={`seatBoard ${draggable ? "isEditable" : ""}`}
      onPointerMove={moveSeat}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="boardAxis horizontal" />
      <div className="boardAxis vertical" />
      {draftSeats.map((seat) => {
        const owner = players.find((player) => player.id === seat.assignedTo);
        const isMine = Boolean(owner && currentPlayerId && owner.id === currentPlayerId);
        const isSelected = selectedSeat === seat.id;
        return (
          <button
            key={seat.id}
            type="button"
            className={`seatTile ${owner ? "assigned" : ""} ${isSelected ? "selected" : ""} ${isMine ? "mine" : ""}`}
            style={{ left: `${seat.x}%`, top: `${seat.y}%` }}
            onPointerDown={(event) => {
              if (!draggable) {
                return;
              }
              dragSeatId.current = seat.id;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onClick={() => {
              if (!owner) {
                onSelectSeat(seat.id);
              }
            }}
            aria-label={`${seat.id}${owner ? ` ${owner.nickname}` : ""}`}
          >
            <strong>{seat.id}</strong>
            <span>{owner ? owner.nickname : draggable ? "拖动" : "可选"}</span>
          </button>
        );
      })}
      {draggable && (
        <div className="dragHint">
          <Move size={15} />
          拖拽排布
        </div>
      )}
    </div>
  );
}

function HostPanel({
  room,
  currentPlayer,
  selectedSeat,
  setSelectedSeat,
  bidAmount,
  setBidAmount,
  canBid,
  hasSubmitted,
  unassignedSeats,
  submitBid,
  hostPlayerName,
  setHostPlayerName,
  onJoinAsPlayer,
  onKick,
  onStart,
  onReveal,
  onNextRound,
  onComplete,
  exportResult
}: {
  room: RoomView;
  currentPlayer?: Player;
  selectedSeat: SeatId | "";
  setSelectedSeat: (value: SeatId | "") => void;
  bidAmount: number;
  setBidAmount: (value: number) => void;
  canBid: boolean;
  hasSubmitted: boolean;
  unassignedSeats: Seat[];
  submitBid: () => void;
  hostPlayerName: string;
  setHostPlayerName: (value: string) => void;
  onJoinAsPlayer: () => void;
  onKick: (playerId: string) => void;
  onStart: () => void;
  onReveal: () => void;
  onNextRound: () => void;
  onComplete: () => void;
  exportResult: (format: "text" | "csv") => void;
}) {
  const activePlayers = room.players.filter((player) => !player.seatId);
  const canStart = room.players.length > 0 && room.players.length <= room.seats.length && (room.phase === "lobby" || room.phase === "layout");
  const canJoinAsPlayer = !currentPlayer && (room.phase === "lobby" || room.phase === "layout");

  return (
    <div className="panelStack">
      <section className="controlPanel">
        <div className="panelTitle">
          <Crown size={18} />
          主持台
        </div>
        <div className="metricRow">
          <Metric icon={<Users size={18} />} label="玩家" value={`${room.players.length}人`} />
          <Metric icon={<MapPinned size={18} />} label="工位" value={`${room.seats.length}个`} />
          <Metric icon={<ClipboardList size={18} />} label="已投" value={`${room.bidCount}/${activePlayers.length}`} />
        </div>
        {canJoinAsPlayer && (
          <div className="hostJoinBox">
            <input
              value={hostPlayerName}
              maxLength={16}
              onChange={(event) => setHostPlayerName(event.target.value)}
              placeholder="主持人昵称"
              aria-label="主持人昵称"
            />
            <button className="secondaryAction" type="button" onClick={onJoinAsPlayer}>
              <LogIn size={17} />
              主持人加入
            </button>
          </div>
        )}
        {(room.phase === "lobby" || room.phase === "layout") && (
          <button className="primaryAction full" type="button" onClick={onStart} disabled={!canStart}>
            <Play size={18} />
            开始暗拍
          </button>
        )}
        {(room.phase === "lobby" || room.phase === "layout") && !canStart && (
          <p className="quietLine actionHint">至少 1 名玩家加入后可开始</p>
        )}
        {room.phase === "round_open" && (
          <button className="primaryAction full" type="button" onClick={onReveal} disabled={room.bidCount === 0}>
            <Eye size={18} />
            揭晓本轮
          </button>
        )}
        {room.phase === "reveal" && (
          <div className="buttonPair">
            <button className="primaryAction" type="button" onClick={onNextRound}>
              <RefreshCw size={18} />
              下一轮
            </button>
            <button className="secondaryAction" type="button" onClick={onComplete}>
              <Trophy size={18} />
              收官
            </button>
          </div>
        )}
        {room.phase === "complete" && <ResultActions exportResult={exportResult} />}
      </section>

      {currentPlayer && (
        <BidCard
          room={room}
          player={currentPlayer}
          title="我的暗拍"
          selectedSeat={selectedSeat}
          setSelectedSeat={setSelectedSeat}
          bidAmount={bidAmount}
          setBidAmount={setBidAmount}
          canBid={canBid}
          hasSubmitted={hasSubmitted}
          unassignedSeats={unassignedSeats}
          submitBid={submitBid}
        />
      )}

      <RevealPanel room={room} />
      <RulesPanel compact />

      <section className="controlPanel">
        <div className="panelTitle">
          <Users size={18} />
          玩家
        </div>
        <div className="playerList">
          {room.players.map((player) => (
            <div key={player.id} className="playerRow">
              <span className={`statusDot ${player.connected ? "online" : ""}`} />
              <div>
                <strong>{player.nickname}</strong>
                <small>{player.seatId ? player.seatId : `${player.balance}币`}</small>
              </div>
              {(room.phase === "lobby" || room.phase === "layout") && (
                <button className="iconButton danger" type="button" onClick={() => onKick(player.id)} aria-label="踢出玩家">
                  <X size={16} />
                </button>
              )}
              {room.submittedPlayerIds.includes(player.id) && <Check className="submittedIcon" size={17} />}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PlayerPanel({
  room,
  player,
  selectedSeat,
  setSelectedSeat,
  bidAmount,
  setBidAmount,
  canBid,
  hasSubmitted,
  unassignedSeats,
  submitBid,
  exportResult
}: {
  room: RoomView;
  player?: Player;
  selectedSeat: SeatId | "";
  setSelectedSeat: (value: SeatId | "") => void;
  bidAmount: number;
  setBidAmount: (value: number) => void;
  canBid: boolean;
  hasSubmitted: boolean;
  unassignedSeats: Seat[];
  submitBid: () => void;
  exportResult: (format: "text" | "csv") => void;
}) {
  if (!player) {
    return (
      <section className="controlPanel">
        <div className="panelTitle">
          <LogIn size={18} />
          重新入场
        </div>
      </section>
    );
  }

  return (
    <div className="panelStack">
      <BidCard
        room={room}
        player={player}
        title="我的筹码"
        selectedSeat={selectedSeat}
        setSelectedSeat={setSelectedSeat}
        bidAmount={bidAmount}
        setBidAmount={setBidAmount}
        canBid={canBid}
        hasSubmitted={hasSubmitted}
        unassignedSeats={unassignedSeats}
        submitBid={submitBid}
      />

      <RevealPanel room={room} currentPlayerId={player.id} />
      <RulesPanel compact />

      {room.phase === "complete" && (
        <section className="controlPanel">
          <ResultActions exportResult={exportResult} />
        </section>
      )}
    </div>
  );
}

function RulesPanel({ compact = false, embedded = false }: { compact?: boolean; embedded?: boolean }) {
  const rules = [
    "每人初始 100 工位币。",
    "每轮选择一个未占工位，填写暗拍金额并锁定。",
    "同一工位最高出价者中标，并支付全部出价。",
    "未中标者扣出价 10% 参与费，最低扣 1 币。",
    "最高价相同时，系统随机幸运胜出。",
    "主持人可持续开启下一轮，不限制轮数。",
    "主持人点击收官后，未分配的人按余额从高到低自动补位。"
  ];
  const visibleRules = compact ? rules.slice(0, 4) : rules;

  return (
    <section className={`${embedded ? "rulesPanel embeddedRules" : "controlPanel rulesPanel"} ${compact ? "compactRules" : ""}`}>
      <div className="panelTitle">
        <ClipboardList size={18} />
        {compact ? "规则速览" : "游戏规则"}
      </div>
      <div className="ruleList">
        {visibleRules.map((rule, index) => (
          <div className="ruleItem" key={rule}>
            <span className="ruleNumber">{index + 1}</span>
            <p>{rule}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function BidCard({
  room,
  player,
  title,
  selectedSeat,
  setSelectedSeat,
  bidAmount,
  setBidAmount,
  canBid,
  hasSubmitted,
  unassignedSeats,
  submitBid
}: {
  room: RoomView;
  player: Player;
  title: string;
  selectedSeat: SeatId | "";
  setSelectedSeat: (value: SeatId | "") => void;
  bidAmount: number;
  setBidAmount: (value: number) => void;
  canBid: boolean;
  hasSubmitted: boolean;
  unassignedSeats: Seat[];
  submitBid: () => void;
}) {
  const maxBid = Math.max(1, player.balance);

  return (
    <section className="controlPanel">
      <div className="panelTitle">
        <Coins size={18} />
        {title}
      </div>
      <div className="coinMeter">
        <strong>{player.balance}</strong>
        <span>/ {INITIAL_BALANCE}</span>
      </div>
      {player.seatId ? (
        <div className="ownedSeat">
          <Trophy size={22} />
          <span>{player.seatId}</span>
        </div>
      ) : (
        <>
          <label className="bidLabel">
            目标工位
            <select
              value={selectedSeat}
              onChange={(event) => {
                setSelectedSeat(event.currentTarget.value as SeatId | "");
                setBidAmount(Math.min(bidAmount, maxBid));
              }}
              disabled={!canBid}
            >
              <option value="">选择工位</option>
              {unassignedSeats.map((seat) => (
                <option key={seat.id} value={seat.id}>
                  {seat.id}
                </option>
              ))}
            </select>
          </label>
          <label className="bidLabel">
            暗拍金额
            <input
              type="range"
              min={1}
              max={maxBid}
              value={bidAmount}
              disabled={!canBid}
              onChange={(event) => setBidAmount(Number(event.target.value))}
            />
          </label>
          <div className="bidInputRow">
            <input
              type="number"
              min={1}
              max={maxBid}
              value={bidAmount}
              disabled={!canBid}
              onChange={(event) => setBidAmount(Math.min(maxBid, Math.max(1, Number(event.target.value))))}
            />
            <button className="primaryAction" type="button" onClick={submitBid} disabled={!canBid}>
              <Gavel size={18} />
              锁定暗拍
            </button>
          </div>
          {hasSubmitted && <p className="quietLine">本轮已提交，等待揭晓</p>}
          {room.phase !== "round_open" && !player.seatId && <p className="quietLine">等待主持人开启下一轮</p>}
        </>
      )}
    </section>
  );
}

function RevealPanel({ room, currentPlayerId }: { room: RoomView; currentPlayerId?: string }) {
  const outcome = room.latestOutcome;
  if (!outcome || (room.phase !== "reveal" && room.phase !== "complete")) {
    return (
      <section className="controlPanel compactPanel">
        <div className="panelTitle">
          <Sparkles size={18} />
          揭晓台
        </div>
        <p className="quietLine">暗拍锁定后统一揭晓</p>
      </section>
    );
  }

  return (
    <section className="controlPanel revealPanel">
      <div className="panelTitle">
        <Sparkles size={18} />
        第 {outcome.round} 轮揭晓
      </div>
      {outcome.winners.length === 0 && outcome.autoAssignments.length === 0 && <p className="quietLine">本轮无人中标</p>}
      <div className="winnerList">
        {outcome.winners.map((winner) => (
          <div
            key={`${winner.seatId}-${winner.playerId}`}
            className={`winnerRow ${winner.playerId === currentPlayerId ? "mine" : ""}`}
          >
            <Trophy size={18} />
            <div>
              <strong>{winner.nickname}</strong>
              <small>
                {winner.seatId} · {winner.amount}币
                {winner.tiedPlayerIds.length > 1 ? " · 幸运胜出" : ""}
              </small>
            </div>
          </div>
        ))}
        {outcome.autoAssignments.map((assignment) => (
          <div key={`${assignment.seatId}-${assignment.playerId}`} className="winnerRow auto">
            <TimerReset size={18} />
            <div>
              <strong>{assignment.nickname}</strong>
              <small>{assignment.seatId} · 余额优先补位</small>
            </div>
          </div>
        ))}
      </div>
      {outcome.penalties.length > 0 && (
        <p className="quietLine">{outcome.penalties.length} 人支付了参与费</p>
      )}
    </section>
  );
}

function Countdown({ endsAt }: { endsAt?: number }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil(((endsAt ?? Date.now()) - Date.now()) / 1000)));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, Math.ceil(((endsAt ?? Date.now()) - Date.now()) / 1000)));
    }, 300);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  return (
    <div className="countdown">
      <TimerReset size={17} />
      {remaining}s
    </div>
  );
}

function ResultActions({ exportResult }: { exportResult: (format: "text" | "csv") => void }) {
  return (
    <div className="buttonPair">
      <button className="secondaryAction" type="button" onClick={() => exportResult("text")}>
        <Copy size={17} />
        复制结果
      </button>
      <button className="secondaryAction" type="button" onClick={() => exportResult("csv")}>
        <Download size={17} />
        CSV
      </button>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getSocketPaths(): string[] {
  const configuredPath = import.meta.env.VITE_SOCKET_PATH;
  if (configuredPath) {
    return [configuredPath];
  }
  if (!import.meta.env.PROD) {
    return ["/socket.io"];
  }
  return ["/api/socket-io", "/api/socket-io/socket.io", "/socket.io"];
}

function wrapSocketClient(client: Socket): RealtimeClient {
  return {
    emit(event, payload, ack) {
      client.emit(event, payload, ack);
    },
    disconnect() {
      client.disconnect();
    }
  };
}

function createHttpRealtimeClient({
  getRoomCode,
  onConnectionChange,
  onRoomUpdate
}: {
  getRoomCode: () => string;
  onConnectionChange: (connected: boolean) => void;
  onRoomUpdate: (room: RoomView, role?: "host" | "player") => void;
}): RealtimeClient {
  let stopped = false;
  let pollTimer: number | undefined;

  const schedulePoll = (delay: number) => {
    if (stopped) {
      return;
    }
    pollTimer = window.setTimeout(poll, delay);
  };

  const poll = async () => {
    if (stopped) {
      return;
    }

    try {
      const code = getRoomCode();
      const query = code ? `?code=${encodeURIComponent(code)}&clientId=${encodeURIComponent(getClientId())}` : "";
      const response = await fetch(`/api/realtime${query}`, {
        cache: "no-store",
        headers: {
          "x-client-id": getClientId()
        }
      });
      const data = (await response.json()) as Ack<{ role?: "host" | "player"; room?: RoomView }>;
      if (data.ok) {
        onConnectionChange(true);
        if (data.room) {
          onRoomUpdate(data.room, data.role);
        }
      } else {
        onConnectionChange(false);
      }
    } catch {
      onConnectionChange(false);
    } finally {
      schedulePoll(getRoomCode() ? 1000 : 2500);
    }
  };

  schedulePoll(0);

  return {
    emit(event, payload, ack) {
      void fetch("/api/realtime", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-client-id": getClientId()
        },
        body: JSON.stringify({
          event,
          payload,
          clientId: getClientId()
        })
      })
        .then(async (response) => (await response.json()) as Ack<Record<string, unknown> & { role?: "host" | "player"; room?: RoomView }>)
        .then((response) => {
          if (response.ok && response.room) {
            onRoomUpdate(response.room, response.role);
          }
          ack?.(response);
        })
        .catch(() => {
          onConnectionChange(false);
          ack?.({ ok: false, error: "兼容连接失败，请刷新页面重试" });
        });
    },
    disconnect() {
      stopped = true;
      if (pollTimer) {
        window.clearTimeout(pollTimer);
      }
    }
  };
}

function getClientId(): string {
  const existing = localStorage.getItem(CLIENT_KEY);
  if (existing) {
    return existing;
  }
  const next = crypto.randomUUID();
  localStorage.setItem(CLIENT_KEY, next);
  return next;
}

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
