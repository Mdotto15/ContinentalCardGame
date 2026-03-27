const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 5;
const ROOM_CODE_LENGTH = 5;

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

function createRoomState(code) {
  return {
    code,
    players: [],
    playerNames: {},
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
  return card.rank === 'JOKER' || (card.rank === 'A' && (card.suit === 'hearts' || card.suit === 'diamonds'));
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
    dealerId: room.players[room.dealerIndex] || null,
    stockCount: room.stock.length,
    discardTop: room.discard[room.discard.length - 1] || null,
    discardCount: room.discard.length,
    tableMelds: room.tableMelds,
    winnerOfHand: room.winnerOfHand,
    roundSummary: room.roundSummary,
    maxPlayers: MAX_PLAYERS,
  };
}

function emitState(room) {
  for (const playerId of room.players) {
    io.to(playerId).emit('state', makePublicState(room, playerId));
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

function isRun(cards) {
  if (cards.length < 4) return false;
  if (cards.length > 13) return false;

  const naturals = cards.filter((c) => !isWild(c));
  const wilds = cards.length - naturals.length;
  if (naturals.length === 0) return cards.length >= 4;

  const suit = naturals[0].suit;
  if (!naturals.every((c) => c.suit === suit)) return false;
  if (naturals.length < wilds) return false;

  const naturalValues = naturals.map((c) => rankValue(c.rank));
  const uniqueNaturals = new Set(naturalValues);
  if (uniqueNaturals.size !== naturalValues.length) return false;

  const runLength = cards.length;

  // Check every possible cyclic run start (1..13), so K-A-2-3 is valid.
  for (let start = 1; start <= 13; start += 1) {
    const sequence = [];
    for (let i = 0; i < runLength; i += 1) {
      sequence.push(((start - 1 + i) % 13) + 1);
    }

    const seqSet = new Set(sequence);
    let containsAllNaturals = true;
    uniqueNaturals.forEach((v) => {
      if (!seqSet.has(v)) containsAllNaturals = false;
    });
    if (!containsAllNaturals) continue;

    // Missing positions are wildcard slots. Reject if any two wildcard slots
    // are adjacent in the run order (e.g., 2, JOKER, JOKER, 5).
    const missing = sequence.map((v) => !uniqueNaturals.has(v));
    let hasAdjacentWildSlots = false;
    for (let i = 0; i < missing.length - 1; i += 1) {
      if (missing[i] && missing[i + 1]) {
        hasAdjacentWildSlots = true;
        break;
      }
    }
    if (hasAdjacentWildSlots) continue;

    if (missing.filter(Boolean).length === wilds) return true;
  }

  return false;
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
  if (existing.type === 'run') return isRun(merged) ? merged : null;
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
    let roundScore = scoreHand(room, playerId);
    if (playerId === winnerId) roundScore = winnerBonus;
    room.scores[playerId] += roundScore;
    return {
      id: playerId,
      name: room.playerNames[playerId] || `Player ${index + 1}`,
      roundScore,
      totalScore: room.scores[playerId],
    };
  });

  room.roundSummary = {
    round: room.round,
    winnerId,
    winnerBonus,
    rows,
    canContinue: room.round < CONTRACTS.length,
  };

  room.phase = room.round >= CONTRACTS.length ? 'finished' : 'roundSummary';
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
  if (room.stock.length > 0) room.discard.push(room.stock.pop());

  room.dealerIndex = room.dealerIndex % room.players.length;
  room.turnIndex = (room.dealerIndex + 1) % room.players.length;
  room.turnStage = 'draw';
  room.openedThisTurn = false;
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

function cleanupRoomIfEmpty(roomCode) {
  const room = rooms.get(roomCode);
  if (room && room.players.length === 0) rooms.delete(roomCode);
}

function getRoomForSocket(socketId) {
  const roomCode = socketToRoom.get(socketId);
  if (!roomCode) return null;
  return rooms.get(roomCode) || null;
}

function addPlayerToRoom(room, socketId, name) {
  room.players.push(socketId);
  room.playerNames[socketId] = name;
  room.scores[socketId] = 0;
  room.hands[socketId] = [];
  socketToRoom.set(socketId, room.code);
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }) => {
    if (socketToRoom.has(socket.id)) return sendError(socket, 'You are already in a room.');
    const cleanName = String(name || '').trim() || 'Player 1';
    const code = generateRoomCode();
    const room = createRoomState(code);
    rooms.set(code, room);
    addPlayerToRoom(room, socket.id, cleanName);
    socket.emit('roomJoined', { roomCode: code });
    emitState(room);
  });

  socket.on('joinRoom', ({ roomCode, name }) => {
    if (socketToRoom.has(socket.id)) return sendError(socket, 'You are already in a room.');
    const code = String(roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return sendError(socket, 'Room not found.');
    if (room.players.length >= MAX_PLAYERS) return sendError(socket, 'Room is full (max 5 players).');
    if (room.phase !== 'lobby') return sendError(socket, 'Game already started in this room.');

    const cleanName = String(name || '').trim() || `Player ${room.players.length + 1}`;
    addPlayerToRoom(room, socket.id, cleanName);
    socket.emit('roomJoined', { roomCode: code });
    emitState(room);
  });

  socket.on('startGame', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    if (room.phase !== 'lobby') return sendError(socket, 'Game is already running.');
    if (room.players.length < 2) return sendError(socket, 'Need at least 2 players to start.');
    if (socket.id !== room.players[0]) return sendError(socket, 'Only the room host can start the game.');

    startGame(room);
    emitState(room);
  });

  socket.on('drawStock', () => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.phase !== 'inRound') return;
    if (socket.id !== currentPlayerId(room)) return sendError(socket, 'Not your turn.');
    if (room.turnStage !== 'draw') return sendError(socket, 'You must discard after drawing.');

    ensureStock(room);
    if (room.stock.length === 0) return sendError(socket, 'No cards left in stock.');

    room.hands[socket.id].push(room.stock.pop());
    room.turnStage = 'discard';
    room.openedThisTurn = false;
    emitState(room);
  });

  socket.on('drawDiscard', () => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.phase !== 'inRound') return;
    if (socket.id !== currentPlayerId(room)) return sendError(socket, 'Not your turn.');
    if (room.turnStage !== 'draw') return sendError(socket, 'You must discard after drawing.');
    if (room.discard.length === 0) return sendError(socket, 'Discard pile is empty.');

    room.hands[socket.id].push(room.discard.pop());
    room.turnStage = 'discard';
    room.openedThisTurn = false;
    emitState(room);
  });

  socket.on('open', ({ meldCardIds }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.phase !== 'inRound') return;
    if (socket.id !== currentPlayerId(room)) return sendError(socket, 'Not your turn.');
    if (room.turnStage !== 'discard') return sendError(socket, 'Draw first.');
    if (room.openedThisRound[socket.id]) return sendError(socket, 'You already opened this round.');

    const groups = Array.isArray(meldCardIds) ? meldCardIds : [];
    if (groups.length === 0) return sendError(socket, 'Select cards for opening melds.');

    const flat = groups.flat();
    const unique = new Set(flat);
    if (flat.length !== unique.size) return sendError(socket, 'A card cannot be used in multiple melds.');

    const extracted = removeCardsFromHand(room, socket.id, [...unique]);
    if (!extracted) return sendError(socket, 'One or more selected cards are not in your hand.');

    const byId = new Map(extracted.map((c) => [c.id, c]));
    const melds = groups.map((ids) => ids.map((id) => byId.get(id)).filter(Boolean));
    const valid = validateOpenMelds(room, melds);
    if (!valid.ok) {
      room.hands[socket.id].push(...extracted);
      sendError(socket, valid.error);
      emitState(room);
      return;
    }

    melds.forEach((cards) => {
      room.tableMelds.push({
        id: `m${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ownerId: socket.id,
        type: classifyMeld(cards),
        cards,
      });
    });

    room.openedThisRound[socket.id] = true;
    room.openedThisTurn = true;
    if (room.hands[socket.id].length === 0) {
      finishHand(room, socket.id, true);
    }
    emitState(room);
  });

  socket.on('layoff', ({ meldId, cardIds }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.phase !== 'inRound') return;
    if (socket.id !== currentPlayerId(room)) return sendError(socket, 'Not your turn.');
    if (room.turnStage !== 'discard') return sendError(socket, 'Draw first.');
    if (!room.openedThisRound[socket.id]) return sendError(socket, 'You must open before laying off.');

    const target = room.tableMelds.find((m) => m.id === meldId);
    if (!target) return sendError(socket, 'Target meld not found.');

    const ids = Array.isArray(cardIds) ? cardIds : [];
    if (ids.length === 0) return sendError(socket, 'Select at least one card to lay off.');

    const extracted = removeCardsFromHand(room, socket.id, ids);
    if (!extracted) return sendError(socket, 'One or more selected cards are not in your hand.');

    const merged = addCardsToMeld(target, extracted);
    if (!merged) {
      room.hands[socket.id].push(...extracted);
      sendError(socket, 'Those cards do not fit the selected meld.');
      emitState(room);
      return;
    }

    target.cards = merged;
    if (room.hands[socket.id].length === 0) {
      finishHand(room, socket.id, room.openedThisTurn);
    }
    emitState(room);
  });

  socket.on('discard', ({ cardId }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.phase !== 'inRound') return;
    if (socket.id !== currentPlayerId(room)) return sendError(socket, 'Not your turn.');
    if (room.turnStage !== 'discard') return sendError(socket, 'Draw first.');

    const extracted = removeCardsFromHand(room, socket.id, [cardId]);
    if (!extracted || extracted.length !== 1) {
      return sendError(socket, 'Selected discard card is not in your hand.');
    }

    room.discard.push(extracted[0]);
    if (room.hands[socket.id].length === 0) {
      finishHand(room, socket.id, room.openedThisTurn);
      emitState(room);
      return;
    }

    nextTurn(room);
    emitState(room);
  });

  socket.on('continueRound', () => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.phase !== 'roundSummary') return;
    if (socket.id !== room.players[0]) return sendError(socket, 'Only the room host can continue to next round.');

    room.round += 1;
    room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
    startRound(room);
    emitState(room);
  });

  socket.on('disconnect', () => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    socketToRoom.delete(socket.id);
    if (!room) return;

    const idx = room.players.indexOf(socket.id);
    if (idx === -1) return;
    const wasCurrentPlayer = currentPlayerId(room) === socket.id;

    room.players.splice(idx, 1);
    delete room.playerNames[socket.id];
    delete room.scores[socket.id];
    delete room.hands[socket.id];
    delete room.openedThisRound[socket.id];

    if (room.players.length === 0) {
      rooms.delete(roomCode);
      return;
    }

    if (idx <= room.dealerIndex && room.dealerIndex > 0) room.dealerIndex -= 1;
    if (idx < room.turnIndex && room.turnIndex > 0) room.turnIndex -= 1;
    if (room.turnIndex >= room.players.length) room.turnIndex = 0;
    if (room.dealerIndex >= room.players.length) room.dealerIndex = 0;

    room.tableMelds = room.tableMelds.filter((meld) => meld.ownerId !== socket.id);

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
    }

    emitState(room);
    cleanupRoomIfEmpty(roomCode);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
