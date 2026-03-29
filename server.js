const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 5;
const ROOM_CODE_LENGTH = 5;
const RECONNECT_GRACE_MS = 120000;

const CONTRACTS = [
  { sets: 2, runs: 0, minCards: 6, label: 'Two sets' },
  { sets: 1, runs: 1, minCards: 7, label: 'One set and one run' },
  { sets: 0, runs: 2, minCards: 8, label: 'Two runs' },
  { sets: 3, runs: 0, minCards: 9, label: 'Three sets' },
  { sets: 2, runs: 1, minCards: 10, label: 'Two sets and one run' },
  { sets: 1, runs: 2, minCards: 11, label: 'One set and two runs' },
  { sets: 0, runs: 3, minCards: 12, label: 'Three runs' },
];

const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const rooms = new Map();
const socketToRoom = new Map();
const socketToPlayer = new Map();

function createRoomState(code) {
  return {
    code,
    players: [],
    playerNames: {},
    playerSockets: {},
    disconnectTimers: {},
    scores: {},
    round: 0,
    phase: 'lobby',
    hands: {},
    openedThisRound: {},
    tableMelds: [],
    stock: [],
    discard: [],
    dealerIndex: 0,
    turnIndex: 0,
    turnStage: 'draw',
    openedThisTurn: false,
    discardClaimOpen: false,
    discardClaimCardId: null,
    discardClaimSourcePlayerId: null,
    discardClaimers: [],
    lastDiscardBy: null,
    discardSerial: 0,
    winnerOfHand: null,
    roundSummary: null,
  };
}

function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  } while (rooms.has(code));
  return code;
}

function isWild(card) {
  if (!card) return false;
  return card.rank === 'JOKER';
}

function cardValue(card) {
  if (card.rank === 'JOKER') return 50;
  if (card.rank === 'A') return 20;
  if (['K', 'Q', 'J', '10'].includes(card.rank)) return 10;
  return Number(card.rank);
}

function rankValue(rank) {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  return Number(rank);
}

function createDeck(deckIdx) {
  const cards = [];
  let local = 0;
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ id: `d${deckIdx}-c${local++}`, rank, suit });
    }
  }
  cards.push({ id: `d${deckIdx}-c${local++}`, rank: 'JOKER', suit: 'black' });
  cards.push({ id: `d${deckIdx}-c${local++}`, rank: 'JOKER', suit: 'red' });
  return cards;
}

function deckCountForPlayers(playerCount) {
  return Math.max(2, Math.ceil(playerCount / 2));
}

function buildShoe(playerCount) {
  const decks = deckCountForPlayers(playerCount);
  const shoe = [];
  for (let i = 0; i < decks; i += 1) {
    shoe.push(...createDeck(i + 1));
  }
  return shuffle(shoe);
}

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function currentPlayerId(room) {
  return room.players[room.turnIndex] || null;
}

function currentContract(room) {
  if (room.round < 1 || room.round > CONTRACTS.length) return null;
  return CONTRACTS[room.round - 1];
}

function handSizeForRound(round) {
  return 6 + round;
}

function sortHand(cards) {
  return [...cards].sort((a, b) => {
    if (a.rank === 'JOKER' && b.rank !== 'JOKER') return 1;
    if (b.rank === 'JOKER' && a.rank !== 'JOKER') return -1;
    if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
    return rankValue(a.rank) - rankValue(b.rank);
  });
}

function makePublicState(room, forPlayerId) {
  const players = room.players.map((id, index) => ({
    id,
    name: room.playerNames[id] || `Player ${index + 1}`,
    handCount: room.hands[id] ? room.hands[id].length : 0,
    opened: Boolean(room.openedThisRound[id]),
    score: Number.isFinite(room.scores[id]) ? room.scores[id] : 0,
    connected: Boolean(room.playerSockets[id]),
  }));

  return {
    roomCode: room.code,
    phase: room.phase,
    round: room.round,
    contract: currentContract(room),
    players,
    yourId: forPlayerId,
    isHost: room.players[0] === forPlayerId,
    yourHand: sortHand(room.hands[forPlayerId] || []),
    turnPlayerId: currentPlayerId(room),
    turnStage: room.turnStage,
    discardClaimOpen: room.discardClaimOpen,
    discardClaimedByMe: room.discardClaimers.includes(forPlayerId),
    discardClaimers: room.discardClaimers.map((id) => room.playerNames[id] || 'Player'),
    dealerId: room.players[room.dealerIndex] || null,
    stockCount: room.stock.length,
    discardTop: room.discard[room.discard.length - 1] || null,
    discardCount: room.discard.length,
    discardSerial: room.discardSerial,
    tableMelds: room.tableMelds,
    winnerOfHand: room.winnerOfHand,
    roundSummary: room.roundSummary,
    maxPlayers: MAX_PLAYERS,
  };
}

function emitState(room) {
  for (const playerId of room.players) {
    const socketId = room.playerSockets[playerId];
    if (!socketId) continue;
    io.to(socketId).emit('state', makePublicState(room, playerId));
  }
}

function sendError(socket, message) {
  socket.emit('gameError', message);
}

function nextTurn(room) {
  if (room.players.length === 0) return;
  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  room.turnStage = 'draw';
  room.openedThisTurn = false;
  room.discardClaimOpen = false;
  room.discardClaimCardId = null;
  room.discardClaimSourcePlayerId = null;
  room.discardClaimers = [];
}

function ensureStock(room) {
  if (room.stock.length > 0) return;
  if (room.discard.length <= 1) return;

  const topDiscard = room.discard.pop();
  room.stock = shuffle(room.discard);
  room.discard = [topDiscard];
}

function isSet(cards) {
  if (cards.length < 3) return false;
  const naturals = cards.filter((c) => !isWild(c));
  const wilds = cards.length - naturals.length;

  // Explicit rule: a trio cannot be 1 natural + 2 jokers/wilds.
  if (cards.length === 3 && naturals.length === 1 && wilds === 2) return false;

  if (naturals.length === 0) return cards.length >= 3;
  const target = naturals[0].rank;
  if (!naturals.every((c) => c.rank === target)) return false;
  return naturals.length >= wilds;
}

function canMakeStraightWithValues(values, wilds) {
  if (values.length === 0) return false;
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length !== values.length) return false;
  let needed = 0;
  for (let i = 1; i < unique.length; i += 1) {
    needed += unique[i] - unique[i - 1] - 1;
  }
  return needed <= wilds;
}

function buildRunArrangement(cards) {
  if (cards.length < 4) return null;
  if (cards.length > 13) return null;

  const naturals = cards.filter((c) => !isWild(c));
  const wildCards = cards.filter((c) => isWild(c));
  const wilds = wildCards.length;
  if (naturals.length === 0) return cards.length >= 4 ? [...cards] : null;

  const suit = naturals[0].suit;
  if (!naturals.every((c) => c.suit === suit)) return null;
  if (naturals.length < wilds) return null;

  const naturalByValue = new Map();
  for (const card of naturals) {
    const value = rankValue(card.rank);
    if (naturalByValue.has(value)) return null;
    naturalByValue.set(value, card);
  }

  const runLength = cards.length;
  for (let start = 1; start <= 13; start += 1) {
    const sequence = [];
    for (let i = 0; i < runLength; i += 1) {
      sequence.push(((start - 1 + i) % 13) + 1);
    }

    const seqSet = new Set(sequence);
    let containsAllNaturals = true;
    naturalByValue.forEach((_card, value) => {
      if (!seqSet.has(value)) containsAllNaturals = false;
    });
    if (!containsAllNaturals) continue;

    const missing = sequence.map((value) => !naturalByValue.has(value));
    let hasAdjacentWildSlots = false;
    for (let i = 0; i < missing.length - 1; i += 1) {
      if (missing[i] && missing[i + 1]) {
        hasAdjacentWildSlots = true;
        break;
      }
    }
    if (hasAdjacentWildSlots) continue;
    if (missing.filter(Boolean).length !== wilds) continue;

    // Build ordered run, placing jokers/wilds into open slots.
    const arranged = [];
    let wildIdx = 0;
    for (let i = 0; i < sequence.length; i += 1) {
      const value = sequence[i];
      if (naturalByValue.has(value)) {
        arranged.push(naturalByValue.get(value));
      } else {
        arranged.push(wildCards[wildIdx]);
        wildIdx += 1;
      }
    }
    return arranged;
  }

  return null;
}

function isRun(cards) {
  return Boolean(buildRunArrangement(cards));
}

function classifyMeld(cards) {
  if (isSet(cards)) return 'set';
  if (isRun(cards)) return 'run';
  return null;
}

function validateOpenMelds(room, melds) {
  const contract = currentContract(room);
  if (!contract) return { ok: false, error: 'No active round.' };

  const types = melds.map((m) => classifyMeld(m));
  if (types.includes(null)) return { ok: false, error: 'At least one meld is invalid.' };

  const setCount = types.filter((t) => t === 'set').length;
  const runCount = types.filter((t) => t === 'run').length;
  const cardCount = melds.reduce((sum, meld) => sum + meld.length, 0);

  if (setCount !== contract.sets || runCount !== contract.runs) {
    return { ok: false, error: `Round ${room.round} requires exactly ${contract.label.toLowerCase()}.` };
  }
  if (cardCount < contract.minCards) {
    return { ok: false, error: `Round ${room.round} requires at least ${contract.minCards} cards to open.` };
  }
  return { ok: true };
}

function addCardsToMeld(existing, newCards) {
  const merged = [...existing.cards, ...newCards];
  if (existing.type === 'set') return isSet(merged) ? merged : null;
  if (existing.type === 'run') return buildRunArrangement(merged);
  return null;
}

function removeCardsFromHand(room, playerId, cardIds) {
  const hand = room.hands[playerId] || [];
  const wanted = new Set(cardIds);
  const extracted = [];
  const remaining = [];
  for (const card of hand) {
    if (wanted.has(card.id)) {
      extracted.push(card);
      wanted.delete(card.id);
    } else {
      remaining.push(card);
    }
  }
  if (wanted.size > 0) return null;
  room.hands[playerId] = remaining;
  return extracted;
}

function scoreHand(room, playerId) {
  const hand = room.hands[playerId] || [];
  return hand.reduce((sum, card) => sum + cardValue(card), 0);
}

function finishHand(room, winnerId, wentOutByOpening) {
  room.winnerOfHand = winnerId;
  const winnerBonus = wentOutByOpening ? -10 : 0;

  const rows = room.players.map((playerId, index) => {
    const handCards = sortHand([...(room.hands[playerId] || [])]);
    const handPoints = handCards.reduce((sum, card) => sum + cardValue(card), 0);
    let roundScore = handPoints;
    if (playerId === winnerId) roundScore = winnerBonus;
    room.scores[playerId] += roundScore;
    return {
      id: playerId,
      name: room.playerNames[playerId] || `Player ${index + 1}`,
      roundScore,
      totalScore: room.scores[playerId],
      handPoints,
      handCards,
    };
  });

  const isFinalRound = room.round >= CONTRACTS.length;
  let gameWinnerIds = [];
  if (isFinalRound) {
    const minScore = Math.min(...rows.map((r) => r.totalScore));
    gameWinnerIds = rows.filter((r) => r.totalScore === minScore).map((r) => r.id);
  }

  room.roundSummary = {
    round: room.round,
    winnerId,
    winnerBonus,
    rows,
    canContinue: room.round < CONTRACTS.length,
    isFinalRound,
    gameWinnerIds,
  };

  room.phase = isFinalRound ? 'finished' : 'roundSummary';
  room.discardClaimOpen = false;
  room.discardClaimCardId = null;
  room.discardClaimSourcePlayerId = null;
  room.discardClaimers = [];
}

function startRound(room) {
  room.phase = 'inRound';
  room.winnerOfHand = null;
  room.roundSummary = null;
  room.openedThisRound = {};
  room.tableMelds = [];

  const shoe = buildShoe(room.players.length);
  room.hands = {};

  const handSize = handSizeForRound(room.round);
  for (const playerId of room.players) {
    room.hands[playerId] = shoe.splice(0, handSize);
  }

  room.stock = shoe;
  room.discard = [];
  if (room.stock.length > 0) {
    room.discard.push(room.stock.pop());
    room.lastDiscardBy = null; // initial exposed card is not from a player's discard
  } else {
    room.lastDiscardBy = null;
  }
  room.discardSerial = 0;

  room.dealerIndex = room.dealerIndex % room.players.length;
  room.turnIndex = (room.dealerIndex + 1) % room.players.length;
  room.turnStage = 'draw';
  room.openedThisTurn = false;
  room.discardClaimOpen = false;
  room.discardClaimCardId = null;
  room.discardClaimSourcePlayerId = null;
  room.discardClaimers = [];
}

function startGame(room) {
  room.round = 1;
  room.phase = 'inRound';
  room.dealerIndex = 0;
  for (const playerId of room.players) {
    room.scores[playerId] = 0;
  }
  startRound(room);
}

function resolveDiscardClaimWinner(room) {
  if (!room.discardClaimOpen || room.discardClaimers.length === 0 || !room.discardClaimCardId) return null;

  const claimers = new Set(room.discardClaimers);
  const total = room.players.length;
  if (total < 2) return null;

  // Precedence starts from the next player after current turn player.
  for (let offset = 1; offset < total; offset += 1) {
    const idx = (room.turnIndex + offset) % total;
    const playerId = room.players[idx];
    if (claimers.has(playerId)) return playerId;
  }
  return null;
}

function awardDiscardClaimIfAny(room) {
  const winnerId = resolveDiscardClaimWinner(room);
  if (!winnerId) return;

  const targetIdx = room.discard.findIndex((c) => c.id === room.discardClaimCardId);
  if (targetIdx === -1) return;

  const [claimedCard] = room.discard.splice(targetIdx, 1);
  room.hands[winnerId].push(claimedCard);
  // Claim is resolved just before current player discards. Keep this visible
  // through that discard and clear on the next player's discard phase.
  emitDiscardPickupAnnouncement(room, winnerId, claimedCard, 2);
}

function emitDiscardPickupAnnouncement(room, playerId, card, clearAfterDiscards = 1) {
  const playerName = room.playerNames[playerId] || 'Player';
  const clearAfterDiscardSerial = room.discardSerial + clearAfterDiscards;
  for (const roomPlayerId of room.players) {
    const socketId = room.playerSockets[roomPlayerId];
    if (!socketId) continue;
    io.to(socketId).emit('discardPickupAnnouncement', {
      playerName,
      card,
      clearAfterDiscardSerial,
    });
  }
}

function cleanupRoomIfEmpty(roomCode) {
  const room = rooms.get(roomCode);
  if (room && room.players.length === 0) rooms.delete(roomCode);
}

function clearDisconnectTimer(room, playerId) {
  const timer = room.disconnectTimers[playerId];
  if (timer) {
    clearTimeout(timer);
    delete room.disconnectTimers[playerId];
  }
}

function bindPlayerSocket(room, playerId, socketId) {
  clearDisconnectTimer(room, playerId);
  room.playerSockets[playerId] = socketId;
  socketToRoom.set(socketId, room.code);
  socketToPlayer.set(socketId, playerId);
}

function removePlayerFromRoom(room, playerId) {
  if (!room) return;
  const idx = room.players.indexOf(playerId);
  if (idx === -1) return;
  const wasCurrentPlayer = currentPlayerId(room) === playerId;

  clearDisconnectTimer(room, playerId);
  const activeSocketId = room.playerSockets[playerId];
  if (activeSocketId) {
    socketToRoom.delete(activeSocketId);
    socketToPlayer.delete(activeSocketId);
  }

  room.players.splice(idx, 1);
  delete room.playerNames[playerId];
  delete room.playerSockets[playerId];
  delete room.scores[playerId];
  delete room.hands[playerId];
  delete room.openedThisRound[playerId];
  room.discardClaimers = room.discardClaimers.filter((id) => id !== playerId);

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }

  if (idx <= room.dealerIndex && room.dealerIndex > 0) room.dealerIndex -= 1;
  if (idx < room.turnIndex && room.turnIndex > 0) room.turnIndex -= 1;
  if (room.turnIndex >= room.players.length) room.turnIndex = 0;
  if (room.dealerIndex >= room.players.length) room.dealerIndex = 0;

  room.tableMelds = room.tableMelds.filter((meld) => meld.ownerId !== playerId);

  if (room.phase === 'inRound' && room.players.length < 2) {
    room.phase = 'lobby';
    room.round = 0;
    room.stock = [];
    room.discard = [];
    room.tableMelds = [];
    room.hands = Object.fromEntries(room.players.map((p) => [p, []]));
    room.roundSummary = null;
    room.winnerOfHand = null;
  }

  if (room.phase === 'inRound' && wasCurrentPlayer) {
    room.turnStage = 'draw';
    room.openedThisTurn = false;
    room.discardClaimOpen = false;
    room.discardClaimCardId = null;
    room.discardClaimSourcePlayerId = null;
    room.discardClaimers = [];
  }

  emitState(room);
  cleanupRoomIfEmpty(room.code);
}

function handleSocketDisconnect(socketId) {
  const roomCode = socketToRoom.get(socketId);
  const playerId = socketToPlayer.get(socketId);
  socketToRoom.delete(socketId);
  socketToPlayer.delete(socketId);
  if (!roomCode || !playerId) return;

  const room = rooms.get(roomCode);
  if (!room) return;
  if (room.playerSockets[playerId] !== socketId) return;

  room.playerSockets[playerId] = null;
  clearDisconnectTimer(room, playerId);
  room.disconnectTimers[playerId] = setTimeout(() => {
    const liveRoom = rooms.get(roomCode);
    if (!liveRoom) return;
    if (liveRoom.playerSockets[playerId]) return;
    removePlayerFromRoom(liveRoom, playerId);
  }, RECONNECT_GRACE_MS);

  emitState(room);
}

function getRoomForSocket(socketId) {
  const roomCode = socketToRoom.get(socketId);
  if (!roomCode) return null;
  return rooms.get(roomCode) || null;
}

function getPlayerForSocket(socketId) {
  return socketToPlayer.get(socketId) || null;
}

function addPlayerToRoom(room, playerId, name, socketId) {
  room.players.push(playerId);
  room.playerNames[playerId] = name;
  room.playerSockets[playerId] = null;
  room.scores[playerId] = 0;
  room.hands[playerId] = [];
  bindPlayerSocket(room, playerId, socketId);
}

function sanitizePlayerToken(input) {
  const token = String(input || '').trim();
  if (!token) return null;
  return token.slice(0, 128);
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name, playerToken }) => {
    if (socketToRoom.has(socket.id)) return sendError(socket, 'You are already in a room.');
    const token = sanitizePlayerToken(playerToken);
    if (!token) return sendError(socket, 'Missing player token. Refresh and try again.');
    const cleanName = String(name || '').trim() || 'Player 1';
    const code = generateRoomCode();
    const room = createRoomState(code);
    rooms.set(code, room);
    addPlayerToRoom(room, token, cleanName, socket.id);
    socket.emit('roomJoined', { roomCode: code });
    emitState(room);
  });

  socket.on('joinRoom', ({ roomCode, name, playerToken }) => {
    if (socketToRoom.has(socket.id)) return sendError(socket, 'You are already in a room.');
    const code = String(roomCode || '').trim().toUpperCase();
    const token = sanitizePlayerToken(playerToken);
    if (!token) return sendError(socket, 'Missing player token. Refresh and try again.');
    const room = rooms.get(code);
    if (!room) return sendError(socket, 'Room not found.');

    const cleanName = String(name || '').trim() || `Player ${room.players.length + 1}`;
    const existingIndex = room.players.indexOf(token);
    if (existingIndex !== -1) {
      const existingSocket = room.playerSockets[token];
      if (existingSocket && existingSocket !== socket.id) {
        return sendError(socket, 'This player is already connected.');
      }
      room.playerNames[token] = cleanName;
      bindPlayerSocket(room, token, socket.id);
      socket.emit('roomJoined', { roomCode: code });
      emitState(room);
      return;
    }

    if (room.players.length >= MAX_PLAYERS) return sendError(socket, 'Room is full (max 5 players).');
    if (room.phase !== 'lobby') return sendError(socket, 'Game already started in this room.');

    addPlayerToRoom(room, token, cleanName, socket.id);
    socket.emit('roomJoined', { roomCode: code });
    emitState(room);
  });

  socket.on('startGame', () => {
    const room = getRoomForSocket(socket.id);
    const playerId = getPlayerForSocket(socket.id);
    if (!room) return;
    if (room.phase !== 'lobby') return sendError(socket, 'Game is already running.');
    if (room.players.length < 2) return sendError(socket, 'Need at least 2 players to start.');
    if (playerId !== room.players[0]) return sendError(socket, 'Only the room host can start the game.');

    startGame(room);
    emitState(room);
  });

  socket.on('drawStock', () => {
    const room = getRoomForSocket(socket.id);
    const playerId = getPlayerForSocket(socket.id);
    if (!room || room.phase !== 'inRound') return;
    if (playerId !== currentPlayerId(room)) return sendError(socket, 'Not your turn.');
    if (room.turnStage !== 'draw') return sendError(socket, 'You must discard after drawing.');

    ensureStock(room);
    if (room.stock.length === 0) return sendError(socket, 'No cards left in stock.');

    room.hands[playerId].push(room.stock.pop());
    room.turnStage = 'discard';
    room.openedThisTurn = false;
    room.discardClaimOpen = Boolean(room.discard.length > 0);
    room.discardClaimCardId = room.discardClaimOpen ? room.discard[room.discard.length - 1].id : null;
    room.discardClaimSourcePlayerId = room.discardClaimOpen ? room.lastDiscardBy : null;
    room.discardClaimers = [];
    emitState(room);
  });

  socket.on('drawDiscard', () => {
    const room = getRoomForSocket(socket.id);
    const playerId = getPlayerForSocket(socket.id);
    if (!room || room.phase !== 'inRound') return;
    if (playerId !== currentPlayerId(room)) return sendError(socket, 'Not your turn.');
    if (room.turnStage !== 'draw') return sendError(socket, 'You must discard after drawing.');
    if (room.discard.length === 0) return sendError(socket, 'Discard pile is empty.');

    const takenCard = room.discard.pop();
    room.hands[playerId].push(takenCard);
    room.turnStage = 'discard';
    room.openedThisTurn = false;
    room.discardClaimOpen = false;
    room.discardClaimCardId = null;
    room.discardClaimSourcePlayerId = null;
    room.discardClaimers = [];
    // For normal discard-pile draw: clear after this same player's discard.
    emitDiscardPickupAnnouncement(room, playerId, takenCard, 1);
    emitState(room);
  });

  socket.on('claimDiscard', () => {
    const room = getRoomForSocket(socket.id);
    const playerId = getPlayerForSocket(socket.id);
    if (!room || room.phase !== 'inRound') return;
    if (!room.discardClaimOpen || !room.discardClaimCardId) return;
    if (playerId === currentPlayerId(room)) return;
    if (playerId === room.discardClaimSourcePlayerId) return;

    if (!room.discardClaimers.includes(playerId)) {
      room.discardClaimers.push(playerId);
      emitState(room);
    }
  });

  socket.on('open', ({ meldCardIds }) => {
    const room = getRoomForSocket(socket.id);
    const playerId = getPlayerForSocket(socket.id);
    if (!room || room.phase !== 'inRound') return;
    if (playerId !== currentPlayerId(room)) return sendError(socket, 'Not your turn.');
    if (room.turnStage !== 'discard') return sendError(socket, 'Draw first.');
    if (room.openedThisRound[playerId]) return sendError(socket, 'You already opened this round.');

    const groups = Array.isArray(meldCardIds) ? meldCardIds : [];
    if (groups.length === 0) return sendError(socket, 'Select cards for opening melds.');

    const flat = groups.flat();
    const unique = new Set(flat);
    if (flat.length !== unique.size) return sendError(socket, 'A card cannot be used in multiple melds.');

    const extracted = removeCardsFromHand(room, playerId, [...unique]);
    if (!extracted) return sendError(socket, 'One or more selected cards are not in your hand.');

    const byId = new Map(extracted.map((c) => [c.id, c]));
    const melds = groups.map((ids) => ids.map((id) => byId.get(id)).filter(Boolean));
    const valid = validateOpenMelds(room, melds);
    if (!valid.ok) {
      room.hands[playerId].push(...extracted);
      sendError(socket, valid.error);
      emitState(room);
      return;
    }

    melds.forEach((cards) => {
      const meldType = classifyMeld(cards);
      room.tableMelds.push({
        id: `m${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ownerId: playerId,
        type: meldType,
        cards: meldType === 'run' ? buildRunArrangement(cards) : cards,
      });
    });

    room.openedThisRound[playerId] = true;
    room.openedThisTurn = true;
    if (room.hands[playerId].length === 0) {
      finishHand(room, playerId, true);
    }
    emitState(room);
  });

  socket.on('layoff', ({ meldId, cardIds }) => {
    const room = getRoomForSocket(socket.id);
    const playerId = getPlayerForSocket(socket.id);
    if (!room || room.phase !== 'inRound') return;
    if (playerId !== currentPlayerId(room)) return sendError(socket, 'Not your turn.');
    if (room.turnStage !== 'discard') return sendError(socket, 'Draw first.');
    if (!room.openedThisRound[playerId]) return sendError(socket, 'You must open before laying off.');

    const target = room.tableMelds.find((m) => m.id === meldId);
    if (!target) return sendError(socket, 'Target meld not found.');

    const ids = Array.isArray(cardIds) ? cardIds : [];
    if (ids.length === 0) return sendError(socket, 'Select at least one card to lay off.');

    const extracted = removeCardsFromHand(room, playerId, ids);
    if (!extracted) return sendError(socket, 'One or more selected cards are not in your hand.');

    const merged = addCardsToMeld(target, extracted);
    if (!merged) {
      room.hands[playerId].push(...extracted);
      sendError(socket, 'Those cards do not fit the selected meld.');
      emitState(room);
      return;
    }

    target.cards = merged;
    if (room.hands[playerId].length === 0) {
      finishHand(room, playerId, room.openedThisTurn);
    }
    emitState(room);
  });

  socket.on('discard', ({ cardId }) => {
    const room = getRoomForSocket(socket.id);
    const playerId = getPlayerForSocket(socket.id);
    if (!room || room.phase !== 'inRound') return;
    if (playerId !== currentPlayerId(room)) return sendError(socket, 'Not your turn.');
    if (room.turnStage !== 'discard') return sendError(socket, 'Draw first.');

    const extracted = removeCardsFromHand(room, playerId, [cardId]);
    if (!extracted || extracted.length !== 1) {
      return sendError(socket, 'Selected discard card is not in your hand.');
    }

    // Resolve the previous discard claim window before this new discard lands.
    awardDiscardClaimIfAny(room);

    room.discard.push(extracted[0]);
    room.lastDiscardBy = playerId;
    room.discardSerial += 1;
    room.discardClaimOpen = false;
    room.discardClaimCardId = null;
    room.discardClaimSourcePlayerId = null;
    room.discardClaimers = [];
    if (room.hands[playerId].length === 0) {
      finishHand(room, playerId, room.openedThisTurn);
      emitState(room);
      return;
    }

    nextTurn(room);
    emitState(room);
  });

  socket.on('continueRound', () => {
    const room = getRoomForSocket(socket.id);
    const playerId = getPlayerForSocket(socket.id);
    if (!room || room.phase !== 'roundSummary') return;
    if (playerId !== room.players[0]) return sendError(socket, 'Only the room host can continue to next round.');

    room.round += 1;
    room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
    startRound(room);
    emitState(room);
  });

  socket.on('leaveRoom', () => {
    const room = getRoomForSocket(socket.id);
    const playerId = getPlayerForSocket(socket.id);
    if (room && playerId) removePlayerFromRoom(room, playerId);
    socketToRoom.delete(socket.id);
    socketToPlayer.delete(socket.id);
    socket.emit('leftRoom');
  });

  socket.on('disconnect', () => {
    handleSocketDisconnect(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
