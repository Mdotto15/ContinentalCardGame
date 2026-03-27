const socket = io();

const landingPanel = document.getElementById('landingPanel');
const roomPanel = document.getElementById('roomPanel');
const gamePanels = document.getElementById('gamePanels');

const nameInput = document.getElementById('nameInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const startGameBtn = document.getElementById('startGameBtn');
const lobbyPlayersList = document.getElementById('lobbyPlayersList');

const landingStatus = document.getElementById('landingStatus');
const statusEl = document.getElementById('status');
const roomCodeLabel = document.getElementById('roomCodeLabel');
const roundInfoEl = document.getElementById('roundInfo');
const pileInfoEl = document.getElementById('pileInfo');

const roundSummaryPanel = document.getElementById('roundSummaryPanel');
const roundSummaryTitle = document.getElementById('roundSummaryTitle');
const roundSummaryMeta = document.getElementById('roundSummaryMeta');
const roundSummaryGraphic = document.getElementById('roundSummaryGraphic');
const continueRoundBtn = document.getElementById('continueRoundBtn');

const stockPileBtn = document.getElementById('stockPileBtn');
const discardPileBtn = document.getElementById('discardPileBtn');
const stockCountLabel = document.getElementById('stockCountLabel');
const discardCountLabel = document.getElementById('discardCountLabel');
const discardPileCard = document.getElementById('discardPileCard');

const playersListEl = document.getElementById('playersList');
const handCardsEl = document.getElementById('handCards');
const discardBtn = document.getElementById('discardBtn');
const addPendingMeldBtn = document.getElementById('addPendingMeldBtn');
const clearPendingBtn = document.getElementById('clearPendingBtn');
const openBtn = document.getElementById('openBtn');
const pendingMeldsEl = document.getElementById('pendingMelds');
const meldSelect = document.getElementById('meldSelect');
const layoffBtn = document.getElementById('layoffBtn');
const tableMeldsEl = document.getElementById('tableMelds');

let state = null;
let joinedRoomCode = null;
let selectedCardIds = new Set();
let pendingMelds = [];
let handOrderIds = [];
let draggedCardId = null;

function sanitizeCode(input) {
  return String(input || '').trim().toUpperCase();
}

function syncHandOrder() {
  if (!state || !state.yourHand) {
    handOrderIds = [];
    return;
  }

  const currentIds = state.yourHand.map((c) => c.id);
  const currentSet = new Set(currentIds);
  handOrderIds = handOrderIds.filter((id) => currentSet.has(id));
  currentIds.forEach((id) => {
    if (!handOrderIds.includes(id)) handOrderIds.push(id);
  });
}

function pruneSelectionToCurrentHand() {
  if (!state || !state.yourHand) {
    selectedCardIds.clear();
    pendingMelds = [];
    return;
  }

  const validIds = new Set(state.yourHand.map((c) => c.id));
  selectedCardIds = new Set([...selectedCardIds].filter((id) => validIds.has(id)));

  pendingMelds = pendingMelds
    .map((m) => ({ cardIds: m.cardIds.filter((id) => validIds.has(id)) }))
    .filter((m) => m.cardIds.length > 0);
}

function cardLabel(card) {
  if (!card) return '';
  if (card.rank === 'JOKER') return 'JOKER';
  return `${card.rank}${card.suit[0].toUpperCase()}`;
}

function cardFilename(card) {
  if (!card) return null;
  if (card.rank === 'JOKER') return card.suit === 'red' ? 'red_joker.png' : 'black_joker.png';
  const rankMap = { A: 'ace', K: 'king', Q: 'queen', J: 'jack' };
  const rankPart = rankMap[card.rank] || String(card.rank);
  return `${rankPart}_of_${card.suit}.png`;
}

function cardImageUrl(card) {
  const filename = cardFilename(card);
  if (!filename) return null;
  return encodeURI(`/images/Playing Cards/Playing Cards/PNG-cards-1.3/${filename}`);
}

function longCardLabel(card) {
  if (!card) return '';
  if (card.rank === 'JOKER') return `${card.suit} joker`;
  return `${card.rank} of ${card.suit}`;
}

function makeCardImage(card, className) {
  const img = document.createElement('img');
  img.className = className;
  img.src = cardImageUrl(card);
  img.alt = longCardLabel(card);
  img.title = longCardLabel(card);
  img.loading = 'lazy';
  img.draggable = false;
  return img;
}

function youOpened() {
  if (!state) return false;
  const me = state.players.find((p) => p.id === state.yourId);
  return Boolean(me && me.opened);
}

function isYourTurn() {
  return state && state.turnPlayerId === state.yourId;
}

function canActOnTurn() {
  return state && state.phase === 'inRound' && isYourTurn();
}

function selectedCards() {
  if (!state) return [];
  const handById = new Map(state.yourHand.map((c) => [c.id, c]));
  return [...selectedCardIds].map((id) => handById.get(id)).filter(Boolean);
}

function renderLayout() {
  const inRoom = Boolean(joinedRoomCode);
  const showLobbyBar = inRoom && (!state || state.phase === 'lobby');
  const showGamePanels = inRoom && state && state.phase !== 'lobby';
  landingPanel.classList.toggle('hidden', inRoom);
  roomPanel.classList.toggle('hidden', !showLobbyBar);
  gamePanels.classList.toggle('hidden', !showGamePanels);

  if (joinedRoomCode) {
    roomCodeLabel.textContent = joinedRoomCode;
  }
}

function renderLobbyPlayers() {
  if (!lobbyPlayersList) return;
  lobbyPlayersList.innerHTML = '';

  if (!state || !state.players || state.players.length === 0) {
    lobbyPlayersList.innerHTML = '<li>Waiting for players...</li>';
    return;
  }

  state.players.forEach((p, idx) => {
    const li = document.createElement('li');
    const hostTag = idx === 0 ? ' (host)' : '';
    li.textContent = `${idx + 1}. ${p.name}${hostTag}`;
    lobbyPlayersList.appendChild(li);
  });
}

function renderPlayers() {
  playersListEl.innerHTML = '';
  if (!state || state.players.length === 0) {
    playersListEl.innerHTML = '<li>No players yet.</li>';
    return;
  }

  state.players.forEach((p, idx) => {
    const li = document.createElement('li');
    const turnTag = p.id === state.turnPlayerId ? ' <- turn' : '';
    const dealerTag = p.id === state.dealerId ? ' (dealer)' : '';
    const openTag = p.opened ? ' [opened]' : '';
    const hostTag = state.players[0] && state.players[0].id === p.id ? ' (host)' : '';
    li.textContent = `${idx + 1}. ${p.name}${hostTag}${dealerTag}${turnTag} | hand: ${p.handCount} | score: ${p.score}${openTag}`;
    playersListEl.appendChild(li);
  });
}

function renderHand() {
  handCardsEl.innerHTML = '';
  if (!state || !state.yourHand) return;

  syncHandOrder();
  const cardById = new Map(state.yourHand.map((c) => [c.id, c]));

  handOrderIds.forEach((cardId) => {
    const card = cardById.get(cardId);
    if (!card) return;

    const div = document.createElement('button');
    div.type = 'button';
    div.className = 'hand-card';
    if (selectedCardIds.has(card.id)) div.classList.add('selected');
    div.title = longCardLabel(card);
    div.draggable = true;
    div.dataset.cardId = card.id;

    const img = makeCardImage(card, 'card-face');
    img.addEventListener('error', () => {
      div.innerHTML = '';
      const fallback = document.createElement('div');
      fallback.className = 'card-text-fallback';
      fallback.textContent = cardLabel(card);
      div.appendChild(fallback);
    });
    div.appendChild(img);

    div.addEventListener('click', () => {
      if (selectedCardIds.has(card.id)) selectedCardIds.delete(card.id);
      else selectedCardIds.add(card.id);
      renderHand();
      syncControls();
    });

    div.addEventListener('dragstart', (event) => {
      draggedCardId = card.id;
      div.classList.add('dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', card.id);
      }
    });

    div.addEventListener('dragend', () => {
      draggedCardId = null;
      div.classList.remove('dragging');
    });

    div.addEventListener('dragover', (event) => {
      event.preventDefault();
    });

    div.addEventListener('drop', (event) => {
      event.preventDefault();
      const targetId = card.id;
      const sourceId = draggedCardId || (event.dataTransfer ? event.dataTransfer.getData('text/plain') : '');
      if (!sourceId || sourceId === targetId) return;

      const sourceIndex = handOrderIds.indexOf(sourceId);
      const targetIndex = handOrderIds.indexOf(targetId);
      if (sourceIndex === -1 || targetIndex === -1) return;

      handOrderIds.splice(sourceIndex, 1);
      handOrderIds.splice(targetIndex, 0, sourceId);
      renderHand();
    });

    handCardsEl.appendChild(div);
  });
}

function renderPendingMelds() {
  if (pendingMelds.length === 0) {
    pendingMeldsEl.textContent = 'No pending melds yet.';
    return;
  }

  const handById = new Map((state && state.yourHand ? state.yourHand : []).map((c) => [c.id, c]));
  pendingMeldsEl.innerHTML = pendingMelds
    .map((m, i) => `Meld ${i + 1}: ${m.cardIds.map((id) => cardLabel(handById.get(id))).join(', ')}`)
    .join('<br/>');
}

function renderTableMelds() {
  if (!state || !state.tableMelds || state.tableMelds.length === 0) {
    tableMeldsEl.textContent = 'No melds on table yet.';
    meldSelect.innerHTML = '';
    return;
  }

  tableMeldsEl.innerHTML = '';
  meldSelect.innerHTML = '';

  state.tableMelds.forEach((meld, index) => {
    const owner = state.players.find((p) => p.id === meld.ownerId);
    const ownerName = owner ? owner.name : 'Unknown';

    const box = document.createElement('div');
    box.className = 'meld';

    const heading = document.createElement('div');
    heading.textContent = `#${index + 1} ${meld.type.toUpperCase()} by ${ownerName}`;
    box.appendChild(heading);

    const cardsRow = document.createElement('div');
    cardsRow.className = 'meld-cards';
    meld.cards.forEach((card) => {
      const img = makeCardImage(card, 'card-face mini');
      img.addEventListener('error', () => {
        const span = document.createElement('span');
        span.textContent = cardLabel(card);
        img.replaceWith(span);
      });
      cardsRow.appendChild(img);
    });
    box.appendChild(cardsRow);
    tableMeldsEl.appendChild(box);

    const option = document.createElement('option');
    option.value = meld.id;
    option.textContent = `#${index + 1} ${meld.type.toUpperCase()} (${meld.cards.length} cards)`;
    meldSelect.appendChild(option);
  });
}

function renderRoundInfo() {
  if (!state) {
    roundInfoEl.textContent = 'Waiting for room state...';
    return;
  }

  if (state.phase === 'lobby') {
    roundInfoEl.textContent = `Lobby (${state.players.length}/${state.maxPlayers} players). Host can start the game.`;
    return;
  }

  if (state.phase === 'finished') {
    roundInfoEl.textContent = 'Game complete after 7 rounds. Lowest total score wins.';
    return;
  }

  if (state.phase === 'roundSummary') {
    roundInfoEl.textContent = `Round ${state.round} complete. Review scores, then continue.`;
    return;
  }

  const contract = state.contract
    ? `Round ${state.round}: ${state.contract.label} (min ${state.contract.minCards} cards)`
    : `Round ${state.round}`;

  const turnText = state.turnPlayerId === state.yourId ? 'Your turn' : 'Waiting for another player';
  roundInfoEl.textContent = `${contract}. Stage: ${state.turnStage}. ${turnText}.`;
}

function renderRoundSummary() {
  if (!state || !state.roundSummary) {
    roundSummaryPanel.classList.remove('active');
    return;
  }

  if (state.phase !== 'roundSummary' && state.phase !== 'finished') {
    roundSummaryPanel.classList.remove('active');
    return;
  }

  const summary = state.roundSummary;
  const winner = summary.rows.find((r) => r.id === summary.winnerId);
  const winnerName = winner ? winner.name : 'Unknown';
  const bonusText = summary.winnerBonus === -10 ? ' (opened and went out: -10 bonus)' : '';

  roundSummaryTitle.textContent = `Round ${summary.round} Summary`;
  roundSummaryMeta.textContent = `Winner: ${winnerName}${bonusText}`;

  const maxTotal = Math.max(...summary.rows.map((r) => Math.max(0, r.totalScore)), 1);
  const rowsHtml = summary.rows.map((r) => {
    const width = Math.max(0, Math.round((Math.max(0, r.totalScore) / maxTotal) * 100));
    return `
      <tr>
        <td>${r.name}</td>
        <td>${r.roundScore}</td>
        <td>${r.totalScore}</td>
        <td>
          <div class="score-bar-wrap">
            <div class="score-bar" style="width:${width}%"></div>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  roundSummaryGraphic.innerHTML = `
    <table class="summary-table">
      <thead>
        <tr>
          <th>Player</th>
          <th>Round</th>
          <th>Total</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;

  roundSummaryPanel.classList.add('active');
}

function renderPiles() {
  if (!state || state.phase === 'lobby') {
    pileInfoEl.textContent = 'No active hand.';
    stockCountLabel.textContent = 'Stock: 0';
    discardCountLabel.textContent = 'Discard: 0';
    discardPileCard.innerHTML = '<div class="pile-empty">Empty</div>';
    return;
  }

  const discard = state.discardTop ? longCardLabel(state.discardTop) : 'none';
  let info = `Click stock (face-down) or discard (face-up) pile to draw. Discard top: ${discard}.`;
  if (state.discardClaimOpen) {
    const claimers = state.discardClaimers && state.discardClaimers.length > 0
      ? ` Claim requests: ${state.discardClaimers.join(', ')}.`
      : ' Claim window open.';
    info += claimers;
  }
  pileInfoEl.textContent = info;
  stockCountLabel.textContent = `Stock: ${state.stockCount}`;
  discardCountLabel.textContent = `Discard: ${state.discardCount}`;

  discardPileCard.innerHTML = '';
  if (state.discardTop) {
    const img = makeCardImage(state.discardTop, 'card-face');
    img.addEventListener('error', () => {
      const fallback = document.createElement('span');
      fallback.textContent = cardLabel(state.discardTop);
      img.replaceWith(fallback);
    });
    discardPileCard.appendChild(img);
  } else {
    discardPileCard.innerHTML = '<div class="pile-empty">Empty</div>';
  }
}

function syncControls() {
  pruneSelectionToCurrentHand();

  const inLobby = state && state.phase === 'lobby';
  const inRound = state && state.phase === 'inRound';
  const stageDraw = state && state.turnStage === 'draw';
  const stageDiscard = state && state.turnStage === 'discard';
  const inSummary = state && state.phase === 'roundSummary';

  const playerCount = state && state.players ? state.players.length : 0;
  startGameBtn.textContent = `Start Game (${playerCount}/${state ? state.maxPlayers : 5})`;
  startGameBtn.disabled = !inLobby || !state || !state.isHost || playerCount < 2;
  continueRoundBtn.disabled = !inSummary || !state || !state.isHost;

  stockPileBtn.disabled = !canActOnTurn() || !stageDraw || !state || state.stockCount < 1;
  const canDrawDiscard = canActOnTurn() && stageDraw && state && state.discardTop;
  const canClaimDiscard = state
    && state.phase === 'inRound'
    && !isYourTurn()
    && state.discardClaimOpen
    && !state.discardClaimedByMe;
  discardPileBtn.disabled = !(canDrawDiscard || canClaimDiscard);

  discardBtn.disabled = !canActOnTurn() || !stageDiscard || selectedCardIds.size !== 1;
  addPendingMeldBtn.disabled = !canActOnTurn() || !stageDiscard || selectedCardIds.size < 3;
  clearPendingBtn.disabled = pendingMelds.length === 0;
  openBtn.disabled = !canActOnTurn() || !stageDiscard || pendingMelds.length === 0 || youOpened();
  layoffBtn.disabled = !canActOnTurn() || !stageDiscard || !youOpened() || selectedCardIds.size < 1 || !meldSelect.value;

  if (!inRound) {
    selectedCardIds.clear();
    pendingMelds = [];
  }
}

function render() {
  renderLayout();
  renderLobbyPlayers();
  renderRoundInfo();
  renderPiles();
  renderPlayers();
  renderHand();
  renderPendingMelds();
  renderTableMelds();
  renderRoundSummary();
  syncControls();
}

createRoomBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) {
    landingStatus.textContent = 'Enter your name first.';
    return;
  }
  socket.emit('createRoom', { name });
});

joinRoomBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  const code = sanitizeCode(roomCodeInput.value);
  if (!name) {
    landingStatus.textContent = 'Enter your name first.';
    return;
  }
  if (!code) {
    landingStatus.textContent = 'Enter a room code.';
    return;
  }
  socket.emit('joinRoom', { roomCode: code, name });
});

startGameBtn.addEventListener('click', () => {
  socket.emit('startGame');
});

continueRoundBtn.addEventListener('click', () => {
  socket.emit('continueRound');
});

stockPileBtn.addEventListener('click', () => {
  socket.emit('drawStock');
});

discardPileBtn.addEventListener('click', () => {
  if (!state) return;
  const canDrawDiscard = canActOnTurn() && state.turnStage === 'draw';
  if (canDrawDiscard) {
    socket.emit('drawDiscard');
    return;
  }

  const canClaimDiscard = state.phase === 'inRound'
    && !isYourTurn()
    && state.discardClaimOpen
    && !state.discardClaimedByMe;
  if (canClaimDiscard) {
    socket.emit('claimDiscard');
    statusEl.textContent = 'Discard claim registered. Precedence will follow turn order.';
  }
});

discardBtn.addEventListener('click', () => {
  const chosen = selectedCards();
  if (chosen.length !== 1) return;
  const cardId = chosen[0].id;
  selectedCardIds.clear();
  socket.emit('discard', { cardId });
});

addPendingMeldBtn.addEventListener('click', () => {
  const cards = selectedCards();
  if (cards.length < 3) return;
  const cardIds = cards.map((c) => c.id);
  pendingMelds.push({ cardIds });
  cardIds.forEach((id) => selectedCardIds.delete(id));
  render();
});

clearPendingBtn.addEventListener('click', () => {
  pendingMelds = [];
  render();
});

openBtn.addEventListener('click', () => {
  if (pendingMelds.length === 0) return;
  socket.emit('open', { meldCardIds: pendingMelds.map((m) => m.cardIds) });
  pendingMelds = [];
  selectedCardIds.clear();
});

layoffBtn.addEventListener('click', () => {
  const meldId = meldSelect.value;
  const cardIds = [...selectedCardIds];
  if (!meldId || cardIds.length === 0) return;
  socket.emit('layoff', { meldId, cardIds });
  selectedCardIds.clear();
});

socket.on('connect', () => {
  landingStatus.textContent = 'Connected. Create or join a room.';
});

socket.on('roomJoined', ({ roomCode }) => {
  joinedRoomCode = roomCode;
  landingStatus.textContent = `Joined room ${roomCode}.`;
  renderLayout();
});

socket.on('state', (nextState) => {
  state = nextState;
  if (state.roomCode) joinedRoomCode = state.roomCode;
  render();

  if (state.phase === 'lobby') {
    statusEl.textContent = state.isHost
      ? 'Waiting for players. Click Start Game when ready.'
      : 'Waiting for host to start the game.';
  } else if (state.phase === 'finished') {
    statusEl.textContent = 'Game finished. Create a new room for a new match.';
  } else if (state.winnerOfHand) {
    const winner = state.players.find((p) => p.id === state.winnerOfHand);
    if (winner) {
      statusEl.textContent = `${winner.name} ended the hand.`;
    }
  }
});

socket.on('gameError', (message) => {
  if (!joinedRoomCode) landingStatus.textContent = message;
  else {
    statusEl.textContent = message;
  }
});
