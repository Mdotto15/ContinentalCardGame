const socket = io();
const PLAYER_TOKEN_STORAGE_KEY = 'continental_player_token_v1';
const PLAYER_NAME_STORAGE_KEY = 'continental_player_name_v1';
const LAST_ROOM_STORAGE_KEY = 'continental_last_room_v1';
const BACKGROUND_CHOICE_STORAGE_KEY = 'continental_bg_choice_v1';
const DEAL_ANIMATION_STEP_MS = 120;
const BACKGROUND_OPTIONS = [
  { id: 'tabletop_jpg', file: 'tabletop.jpg', label: 'Tabletop' },
  { id: 'casino', file: 'casino.jpg', label: 'Casino' },
  { id: 'green_table', file: 'green_table.jpg', label: 'Green Table' },
  { id: 'red_felt', file: 'red felt.jpg', label: 'Red Felt' },
  { id: 'sky', file: 'sky.jpg', label: 'Sky' },
];

const landingPanel = document.getElementById('landingPanel');
const roomPanel = document.getElementById('roomPanel');
const gamePanels = document.getElementById('gamePanels');

const nameInput = document.getElementById('nameInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const startGameBtn = document.getElementById('startGameBtn');
const leaveLobbyBtn = document.getElementById('leaveLobbyBtn');
const copyRoomCodeBtn = document.getElementById('copyRoomCodeBtn');
const bgToggleBtn = document.getElementById('bgToggleBtn');
const lobbyPlayersList = document.getElementById('lobbyPlayersList');

const landingStatus = document.getElementById('landingStatus');
const statusEl = document.getElementById('status');
const roomCodeLabel = document.getElementById('roomCodeLabel');
const roundInfoEl = document.getElementById('roundInfo');
const pileInfoEl = document.getElementById('pileInfo');
const turnBadge = document.getElementById('turnBadge');
const handPanel = document.getElementById('handPanel');

const roundOverlay = document.getElementById('roundOverlay');
const roundSummaryTitle = document.getElementById('roundSummaryTitle');
const roundSummaryMeta = document.getElementById('roundSummaryMeta');
const roundSummaryGraphic = document.getElementById('roundSummaryGraphic');
const roundSummaryHands = document.getElementById('roundSummaryHands');
const continueRoundBtn = document.getElementById('continueRoundBtn');
const endGameBtn = document.getElementById('endGameBtn');

const stockPileBtn = document.getElementById('stockPileBtn');
const discardPileBtn = document.getElementById('discardPileBtn');
const stockCountLabel = document.getElementById('stockCountLabel');
const discardCountLabel = document.getElementById('discardCountLabel');
const discardPileCard = document.getElementById('discardPileCard');
const claimAnnouncementEl = document.getElementById('claimAnnouncement');
const playerHandFansEl = document.getElementById('playerHandFans');

const playersListEl = document.getElementById('playersList');
const handCardsEl = document.getElementById('handCards');
const discardBtn = document.getElementById('discardBtn');
const quickLayoffActionsEl = document.getElementById('quickLayoffActions');
const sortSuitBtn = document.getElementById('sortSuitBtn');
const sortNumberBtn = document.getElementById('sortNumberBtn');
const addPendingMeldBtn = document.getElementById('addPendingMeldBtn');
const suggestOpenBtn = document.getElementById('suggestOpenBtn');
const clearPendingBtn = document.getElementById('clearPendingBtn');
const openBtn = document.getElementById('openBtn');
const pendingMeldsEl = document.getElementById('pendingMelds');
const tableMeldsEl = document.getElementById('tableMelds');
const tableMeldsPanel = document.getElementById('tableMeldsPanel');

let state = null;
let joinedRoomCode = null;
let selectedCardIds = new Set();
let pendingMelds = [];
let handOrderIds = [];
let draggedCardId = null;
let draggedCardIds = [];
let dragPlacement = { targetId: null, mode: 'before' };
let lastClickedCardId = null;
let claimAnnouncementTimer = null;
let claimAnnouncementClearAfterSerial = null;
let pendingOpenAnalysis = null;
let layoffOptionsByCard = new Map();
let quickLayoffCardId = null;
let dealAnimation = {
  active: false,
  visibleCount: 0,
  latestRevealedId: null,
  timer: null,
};
const playerToken = getOrCreatePlayerToken();
let backgroundChoice = localStorage.getItem(BACKGROUND_CHOICE_STORAGE_KEY) || 'tabletop';

function sanitizeCode(input) {
  return String(input || '').trim().toUpperCase();
}

function getOrCreatePlayerToken() {
  const existing = localStorage.getItem(PLAYER_TOKEN_STORAGE_KEY);
  if (existing) return existing;

  const generated = (window.crypto && typeof window.crypto.randomUUID === 'function')
    ? window.crypto.randomUUID()
    : `ptok-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  localStorage.setItem(PLAYER_TOKEN_STORAGE_KEY, generated);
  return generated;
}

const savedName = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
if (savedName) nameInput.value = savedName;

const savedRoomCode = sanitizeCode(localStorage.getItem(LAST_ROOM_STORAGE_KEY) || '');
if (savedRoomCode) roomCodeInput.value = savedRoomCode;

function getBackgroundIndexById(id) {
  return BACKGROUND_OPTIONS.findIndex((opt) => opt.id === id);
}

function applyBackgroundChoice(choiceId, persist = true) {
  const idx = getBackgroundIndexById(choiceId);
  const safeIdx = idx >= 0 ? idx : 0;
  const selected = BACKGROUND_OPTIONS[safeIdx];
  backgroundChoice = selected.id;

  const bgUrl = encodeURI(`/images/${selected.file}`);
  document.documentElement.style.setProperty('--table-bg-url', `url('${bgUrl}')`);
  if (bgToggleBtn) bgToggleBtn.textContent = `BG: ${selected.label}`;
  if (persist) localStorage.setItem(BACKGROUND_CHOICE_STORAGE_KEY, selected.id);
}

function resetToLanding(message) {
  joinedRoomCode = null;
  state = null;
  selectedCardIds.clear();
  pendingMelds = [];
  handOrderIds = [];
  clearDragPlacement();
  lastClickedCardId = null;
  clearDealAnimation();
  clearClaimAnnouncement();
  hideRoundOverlay();
  renderLayout();
  localStorage.removeItem(LAST_ROOM_STORAGE_KEY);

  if (message) {
    landingStatus.textContent = message;
  }
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

function clearDealAnimation() {
  if (dealAnimation.timer) {
    clearTimeout(dealAnimation.timer);
  }
  dealAnimation = {
    active: false,
    visibleCount: 0,
    latestRevealedId: null,
    timer: null,
  };
}

function getDraggedGroup(cardId) {
  if (selectedCardIds.has(cardId) && selectedCardIds.size > 0) {
    return handOrderIds.filter((id) => selectedCardIds.has(id));
  }
  return [cardId];
}

function clearDragPlacement() {
  dragPlacement = { targetId: null, mode: 'before' };
}

function applyRangeSelection(toCardId) {
  if (!lastClickedCardId) {
    selectedCardIds.add(toCardId);
    lastClickedCardId = toCardId;
    return;
  }

  const fromIdx = handOrderIds.indexOf(lastClickedCardId);
  const toIdx = handOrderIds.indexOf(toCardId);
  if (fromIdx === -1 || toIdx === -1) {
    selectedCardIds.add(toCardId);
    lastClickedCardId = toCardId;
    return;
  }

  const start = Math.min(fromIdx, toIdx);
  const end = Math.max(fromIdx, toIdx);
  for (let i = start; i <= end; i += 1) {
    selectedCardIds.add(handOrderIds[i]);
  }
  lastClickedCardId = toCardId;
}

function runDealAnimationStep() {
  if (!dealAnimation.active) return;

  const total = handOrderIds.length;
  if (dealAnimation.visibleCount >= total) {
    clearDealAnimation();
    renderHand();
    syncControls();
    return;
  }

  const nextCount = dealAnimation.visibleCount + 1;
  dealAnimation.visibleCount = nextCount;
  dealAnimation.latestRevealedId = handOrderIds[nextCount - 1] || null;
  renderHand();
  syncControls();

  if (nextCount >= total) {
    dealAnimation.timer = setTimeout(() => {
      clearDealAnimation();
      renderHand();
      syncControls();
    }, 180);
    return;
  }

  dealAnimation.timer = setTimeout(runDealAnimationStep, DEAL_ANIMATION_STEP_MS);
}

function maybeStartDealAnimation(previousState, nextState) {
  const isBetweenRounds = Boolean(
    previousState
      && previousState.phase === 'roundSummary'
      && nextState
      && nextState.phase === 'inRound'
      && nextState.round === previousState.round + 1
  );

  if (!isBetweenRounds) {
    if (!nextState || nextState.phase !== 'inRound') clearDealAnimation();
    return;
  }

  clearDealAnimation();
  handOrderIds = (nextState.yourHand || []).map((c) => c.id);
  dealAnimation.active = true;
  dealAnimation.visibleCount = 0;
  dealAnimation.latestRevealedId = null;
  runDealAnimationStep();
}

function cardLabel(card) {
  if (!card) return '';
  if (card.rank === 'JOKER') return 'JOKER';
  return `${card.rank}${card.suit[0].toUpperCase()}`;
}

function isWild(card) {
  return Boolean(card && card.rank === 'JOKER');
}

function rankValue(rank) {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  return Number(rank);
}

function suitSortOrder(suit) {
  if (suit === 'clubs') return 0;
  if (suit === 'diamonds') return 1;
  if (suit === 'hearts') return 2;
  if (suit === 'spades') return 3;
  return 4;
}

function cardPointValue(card) {
  if (!card) return 0;
  if (card.rank === 'JOKER') return 50;
  if (card.rank === 'A') return 20;
  if (['K', 'Q', 'J', '10'].includes(card.rank)) return 10;
  return Number(card.rank);
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

    const arranged = [];
    let wildIdx = 0;
    for (let i = 0; i < sequence.length; i += 1) {
      const value = sequence[i];
      if (naturalByValue.has(value)) arranged.push(naturalByValue.get(value));
      else {
        arranged.push(wildCards[wildIdx]);
        wildIdx += 1;
      }
    }
    return arranged;
  }

  return null;
}

function validateSetDetailed(cards) {
  if (cards.length < 3) return { ok: false, reason: 'Set needs at least 3 cards.' };

  const naturals = cards.filter((c) => !isWild(c));
  const wilds = cards.length - naturals.length;

  if (cards.length === 3 && naturals.length === 1 && wilds === 2) {
    return { ok: false, reason: 'Trio cannot be 1 natural + 2 jokers.' };
  }
  if (naturals.length === 0) return { ok: true, type: 'set' };

  const target = naturals[0].rank;
  if (!naturals.every((c) => c.rank === target)) {
    return { ok: false, reason: 'All natural cards in a set must share the same rank.' };
  }
  if (naturals.length < wilds) {
    return { ok: false, reason: 'Set has too many jokers versus naturals.' };
  }
  return { ok: true, type: 'set' };
}

function validateRunDetailed(cards) {
  if (cards.length < 4) return { ok: false, reason: 'Run needs at least 4 cards.' };
  if (cards.length > 13) return { ok: false, reason: 'Run cannot exceed 13 cards.' };

  const naturals = cards.filter((c) => !isWild(c));
  const wilds = cards.length - naturals.length;
  if (naturals.length === 0) return { ok: true, type: 'run' };

  const suit = naturals[0].suit;
  if (!naturals.every((c) => c.suit === suit)) {
    return { ok: false, reason: 'All natural cards in a run must share one suit.' };
  }
  if (naturals.length < wilds) {
    return { ok: false, reason: 'Run has too many jokers versus naturals.' };
  }

  const naturalByValue = new Map();
  for (const card of naturals) {
    const value = rankValue(card.rank);
    if (naturalByValue.has(value)) {
      return { ok: false, reason: 'Run cannot contain duplicate natural ranks.' };
    }
    naturalByValue.set(value, card);
  }

  const runLength = cards.length;
  let sawContiguousButAdjacentWilds = false;
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
    const missingCount = missing.filter(Boolean).length;
    if (missingCount !== wilds) continue;

    let adjacent = false;
    for (let i = 0; i < missing.length - 1; i += 1) {
      if (missing[i] && missing[i + 1]) {
        adjacent = true;
        break;
      }
    }
    if (adjacent) {
      sawContiguousButAdjacentWilds = true;
      continue;
    }
    return { ok: true, type: 'run' };
  }

  if (sawContiguousButAdjacentWilds) {
    return { ok: false, reason: 'Run cannot have back-to-back jokers.' };
  }
  return { ok: false, reason: 'Cards cannot form one contiguous suited run.' };
}

function classifyMeldDetailed(cards) {
  const setResult = validateSetDetailed(cards);
  if (setResult.ok) return setResult;

  const runResult = validateRunDetailed(cards);
  if (runResult.ok) return runResult;

  return {
    ok: false,
    reason: cards.length < 4 ? setResult.reason : runResult.reason,
  };
}

function analyzePendingOpenMelds() {
  if (!state || !state.contract) return null;

  const handById = new Map((state.yourHand || []).map((c) => [c.id, c]));
  const details = pendingMelds.map((m, index) => {
    const cards = m.cardIds.map((id) => handById.get(id)).filter(Boolean);
    if (cards.length !== m.cardIds.length) {
      return {
        index,
        cards,
        valid: false,
        type: null,
        reason: 'One or more cards are no longer in your hand.',
      };
    }

    const result = classifyMeldDetailed(cards);
    return {
      index,
      cards,
      valid: result.ok,
      type: result.type || null,
      reason: result.reason || '',
    };
  });

  const invalid = details.filter((d) => !d.valid);
  const setCount = details.filter((d) => d.valid && d.type === 'set').length;
  const runCount = details.filter((d) => d.valid && d.type === 'run').length;
  const cardCount = details.reduce((sum, d) => sum + d.cards.length, 0);
  const contract = state.contract;

  let contractReason = '';
  if (invalid.length > 0) {
    contractReason = 'At least one pending meld is invalid.';
  } else if (setCount !== contract.sets || runCount !== contract.runs) {
    contractReason = `Need exactly ${contract.sets} set(s) and ${contract.runs} run(s).`;
  } else if (cardCount < contract.minCards) {
    contractReason = `Need at least ${contract.minCards} cards in opening melds.`;
  }

  return {
    details,
    setCount,
    runCount,
    cardCount,
    contract,
    canOpen: invalid.length === 0 && contractReason === '',
    contractReason,
  };
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

function sortHandOneTime(mode) {
  if (!state || !state.yourHand || state.yourHand.length === 0) return;

  const sorted = [...state.yourHand].sort((a, b) => {
    if (a.rank === 'JOKER' && b.rank !== 'JOKER') return 1;
    if (b.rank === 'JOKER' && a.rank !== 'JOKER') return -1;

    if (mode === 'number') {
      const rankDiff = rankValue(a.rank) - rankValue(b.rank);
      if (rankDiff !== 0) return rankDiff;
      const suitDiff = suitSortOrder(a.suit) - suitSortOrder(b.suit);
      if (suitDiff !== 0) return suitDiff;
      return a.id.localeCompare(b.id);
    }

    const suitDiff = suitSortOrder(a.suit) - suitSortOrder(b.suit);
    if (suitDiff !== 0) return suitDiff;
    const rankDiff = rankValue(a.rank) - rankValue(b.rank);
    if (rankDiff !== 0) return rankDiff;
    return a.id.localeCompare(b.id);
  });

  handOrderIds = sorted.map((c) => c.id);
  renderHand();
}

function canUseQuickLayoff() {
  return Boolean(
    state
      && state.phase === 'inRound'
      && isYourTurn()
      && state.turnStage === 'discard'
      && youOpened()
      && Array.isArray(state.tableMelds)
      && state.tableMelds.length > 0
  );
}

function cardFitsMeld(card, meld) {
  const merged = [...(meld.cards || []), card];
  if (meld.type === 'set') {
    const result = validateSetDetailed(merged);
    return result.ok;
  }
  if (meld.type === 'run') {
    return Boolean(buildRunArrangement(merged));
  }
  return false;
}

function computeLayoffOptionsByCard() {
  const map = new Map();
  if (!canUseQuickLayoff()) return map;

  const hand = state.yourHand || [];
  const tableMelds = state.tableMelds || [];
  hand.forEach((card) => {
    const options = [];
    tableMelds.forEach((meld, index) => {
      if (cardFitsMeld(card, meld)) {
        options.push({
          meldId: meld.id,
          index,
          type: meld.type,
        });
      }
    });
    if (options.length > 0) map.set(card.id, options);
  });
  return map;
}

function renderQuickLayoffActions() {
  if (!quickLayoffActionsEl) return;

  layoffOptionsByCard = computeLayoffOptionsByCard();
  const available = quickLayoffCardId ? layoffOptionsByCard.get(quickLayoffCardId) : null;

  if (!available || available.length === 0) {
    quickLayoffCardId = null;
    quickLayoffActionsEl.innerHTML = '';
    quickLayoffActionsEl.classList.add('hidden');
    return;
  }

  quickLayoffActionsEl.innerHTML = '';
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = `Lay ${cardLabel((state.yourHand || []).find((c) => c.id === quickLayoffCardId))} to:`;
  quickLayoffActionsEl.appendChild(hint);

  available.forEach((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'secondary quick-layoff-btn';
    btn.textContent = `#${opt.index + 1} ${String(opt.type || '').toUpperCase()}`;
    btn.addEventListener('click', () => {
      socket.emit('layoff', { meldId: opt.meldId, cardIds: [quickLayoffCardId] });
      selectedCardIds.delete(quickLayoffCardId);
      quickLayoffCardId = null;
      renderQuickLayoffActions();
      syncControls();
    });
    quickLayoffActionsEl.appendChild(btn);
  });

  quickLayoffActionsEl.classList.remove('hidden');
}

function popcount(n) {
  let x = n >>> 0;
  let count = 0;
  while (x) {
    count += x & 1;
    x >>>= 1;
  }
  return count;
}

function enumerateMeldCandidates(cards) {
  const n = cards.length;
  if (n < 3) return [];

  const maxMask = 1 << n;
  const candidates = [];
  const seen = new Set();

  for (let mask = 1; mask < maxMask; mask += 1) {
    const size = popcount(mask);
    if (size < 3) continue;

    const subset = [];
    const ids = [];
    let points = 0;
    for (let i = 0; i < n; i += 1) {
      if (mask & (1 << i)) {
        subset.push(cards[i]);
        ids.push(cards[i].id);
        points += cardPointValue(cards[i]);
      }
    }

    const result = classifyMeldDetailed(subset);
    if (!result.ok || !result.type) continue;
    if (result.type === 'run' && size < 4) continue;

    ids.sort();
    const key = `${result.type}|${ids.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const arrangedCards = result.type === 'run' ? buildRunArrangement(subset) : [...subset];
    if (!arrangedCards) continue;

    candidates.push({
      type: result.type,
      mask,
      cardIds: ids,
      cards: arrangedCards,
      cardCount: size,
      points,
    });
  }

  return candidates;
}

function betterCombo(a, b) {
  if (!a) return true;
  if (b.projectedRemaining !== a.projectedRemaining) return b.projectedRemaining < a.projectedRemaining;
  if (b.projectedLayoffCount !== a.projectedLayoffCount) return b.projectedLayoffCount > a.projectedLayoffCount;
  if (b.totalOpenCards !== a.totalOpenCards) return b.totalOpenCards > a.totalOpenCards;
  if (b.addedToOpenCount !== a.addedToOpenCount) return b.addedToOpenCount > a.addedToOpenCount;
  if (b.totalPoints !== a.totalPoints) return b.totalPoints > a.totalPoints;
  if (b.projectedLayoffPoints !== a.projectedLayoffPoints) return b.projectedLayoffPoints > a.projectedLayoffPoints;
  return b.melds.length < a.melds.length;
}

function tryAddCardToMeld(meld, card) {
  const merged = [...(meld.cards || []), card];
  if (meld.type === 'set') {
    const setCheck = validateSetDetailed(merged);
    if (!setCheck.ok) return null;
    return merged;
  }
  if (meld.type === 'run') {
    return buildRunArrangement(merged);
  }
  return null;
}

function simulateBestLayoff(cards, baseMelds) {
  if (!cards || cards.length === 0 || !baseMelds || baseMelds.length === 0) {
    return { count: 0, points: 0 };
  }

  let best = { count: 0, points: 0 };

  function dfs(cardIndex, meldsState, laidCount, laidPoints) {
    if (cardIndex >= cards.length) {
      if (
        laidCount > best.count
        || (laidCount === best.count && laidPoints > best.points)
      ) {
        best = { count: laidCount, points: laidPoints };
      }
      return;
    }

    // Upper-bound prune.
    if (laidCount + (cards.length - cardIndex) < best.count) return;

    // Option 1: keep card in hand.
    dfs(cardIndex + 1, meldsState, laidCount, laidPoints);

    // Option 2: lay off card to any compatible meld.
    const card = cards[cardIndex];
    for (let i = 0; i < meldsState.length; i += 1) {
      const nextCards = tryAddCardToMeld(meldsState[i], card);
      if (!nextCards) continue;

      const nextMelds = meldsState.map((m, idx) => (
        idx === i
          ? { type: m.type, cards: nextCards }
          : { type: m.type, cards: [...(m.cards || [])] }
      ));

      dfs(
        cardIndex + 1,
        nextMelds,
        laidCount + 1,
        laidPoints + cardPointValue(card),
      );
    }
  }

  const initialMelds = baseMelds.map((m) => ({ type: m.type, cards: [...(m.cards || [])] }));
  dfs(0, initialMelds, 0, 0);
  return best;
}

function maximizeCardsIntoOpenMelds(cards, openMelds) {
  if (!cards || cards.length === 0 || !openMelds || openMelds.length === 0) {
    return {
      melds: (openMelds || []).map((m) => ({ type: m.type, cards: [...(m.cards || [])] })),
      usedCardIds: new Set(),
      addedCount: 0,
      addedPoints: 0,
    };
  }

  let best = null;

  function cloneMelds(melds) {
    return melds.map((m) => ({ type: m.type, cards: [...(m.cards || [])] }));
  }

  function evaluate(candidate) {
    if (!best) return true;
    if (candidate.addedCount !== best.addedCount) return candidate.addedCount > best.addedCount;
    return candidate.addedPoints > best.addedPoints;
  }

  function dfs(cardIndex, meldsState, usedCardIds, addedCount, addedPoints) {
    if (cardIndex >= cards.length) {
      const candidate = {
        melds: cloneMelds(meldsState),
        usedCardIds: new Set(usedCardIds),
        addedCount,
        addedPoints,
      };
      if (evaluate(candidate)) best = candidate;
      return;
    }

    if (addedCount + (cards.length - cardIndex) < (best ? best.addedCount : 0)) return;

    const card = cards[cardIndex];

    // Skip card.
    dfs(cardIndex + 1, meldsState, usedCardIds, addedCount, addedPoints);

    // Add card to any compatible open meld.
    for (let i = 0; i < meldsState.length; i += 1) {
      const nextCards = tryAddCardToMeld(meldsState[i], card);
      if (!nextCards) continue;

      const nextMelds = meldsState.map((m, idx) => (
        idx === i
          ? { type: m.type, cards: nextCards }
          : { type: m.type, cards: [...(m.cards || [])] }
      ));
      const nextUsed = new Set(usedCardIds);
      nextUsed.add(card.id);

      dfs(
        cardIndex + 1,
        nextMelds,
        nextUsed,
        addedCount + 1,
        addedPoints + cardPointValue(card),
      );
    }
  }

  const base = openMelds.map((m) => ({ type: m.type, cards: [...(m.cards || [])] }));
  dfs(0, base, new Set(), 0, 0);

  return best || {
    melds: base,
    usedCardIds: new Set(),
    addedCount: 0,
    addedPoints: 0,
  };
}

function findBestOpeningAddition(cards, needSets, needRuns, minCardsToAdd, projectionBaseMelds) {
  const candidates = enumerateMeldCandidates(cards);
  if (candidates.length === 0) return null;

  const byType = candidates.map((c, idx) => ({ ...c, idx }));
  let best = null;

  function dfs(startIdx, remSets, remRuns, usedMask, chosen, totalCards, totalPoints) {
    const remTotal = remSets + remRuns;
    if (remTotal === 0) {
      if (totalCards < minCardsToAdd) return;
      const remainingCards = [];
      for (let i = 0; i < cards.length; i += 1) {
        if ((usedMask & (1 << i)) === 0) remainingCards.push(cards[i]);
      }

      const chosenOpenMelds = chosen.map((m) => ({ type: m.type, cards: [...(m.cards || [])] }));
      const openExpansion = maximizeCardsIntoOpenMelds(remainingCards, chosenOpenMelds);
      const remainingAfterExpansion = remainingCards.filter((c) => !openExpansion.usedCardIds.has(c.id));

      const projectionMelds = [
        ...projectionBaseMelds.map((m) => ({ type: m.type, cards: [...(m.cards || [])] })),
        ...openExpansion.melds.map((m) => ({ type: m.type, cards: [...(m.cards || [])] })),
      ];
      const layoffProjection = simulateBestLayoff(remainingAfterExpansion, projectionMelds);
      const combo = {
        melds: openExpansion.melds,
        totalCards,
        totalPoints,
        totalOpenCards: totalCards + openExpansion.addedCount,
        addedToOpenCount: openExpansion.addedCount,
        addedToOpenPoints: openExpansion.addedPoints,
        projectedLayoffCount: layoffProjection.count,
        projectedLayoffPoints: layoffProjection.points,
        projectedRemaining: remainingAfterExpansion.length - layoffProjection.count,
      };
      if (betterCombo(best, combo)) best = combo;
      return;
    }

    for (let i = startIdx; i < byType.length; i += 1) {
      const cand = byType[i];
      if ((cand.mask & usedMask) !== 0) continue;
      if (cand.type === 'set' && remSets <= 0) continue;
      if (cand.type === 'run' && remRuns <= 0) continue;

      chosen.push(cand);
      dfs(
        i + 1,
        remSets - (cand.type === 'set' ? 1 : 0),
        remRuns - (cand.type === 'run' ? 1 : 0),
        usedMask | cand.mask,
        chosen,
        totalCards + cand.cardCount,
        totalPoints + cand.points,
      );
      chosen.pop();
    }
  }

  dfs(0, needSets, needRuns, 0, [], 0, 0);
  return best;
}

function suggestBestOpenMelds() {
  if (!state || state.phase !== 'inRound' || state.turnStage !== 'discard' || !isYourTurn()) {
    statusEl.textContent = 'Auto Add Best Open is available on your discard stage only.';
    return;
  }
  if (!state.contract) {
    statusEl.textContent = 'No active round contract.';
    return;
  }
  if (dealAnimation.active) {
    statusEl.textContent = 'Wait until dealing animation is complete.';
    return;
  }

  const current = analyzePendingOpenMelds();
  if (current && current.details.some((d) => !d.valid)) {
    statusEl.textContent = 'Pending melds include invalid groups. Fix or clear them before auto-adding.';
    return;
  }

  const contract = state.contract;
  const existingSetCount = current ? current.setCount : 0;
  const existingRunCount = current ? current.runCount : 0;
  const existingCardCount = current ? current.cardCount : 0;

  const needSets = contract.sets - existingSetCount;
  const needRuns = contract.runs - existingRunCount;
  if (needSets < 0 || needRuns < 0) {
    statusEl.textContent = 'You already have too many pending set/run types for this round.';
    return;
  }
  if (needSets === 0 && needRuns === 0) {
    statusEl.textContent = 'Pending melds already meet the contract types.';
    return;
  }

  const usedIds = new Set();
  pendingMelds.forEach((m) => m.cardIds.forEach((id) => usedIds.add(id)));
  syncHandOrder();
  const availableCards = (state.yourHand || []).filter((c) => !usedIds.has(c.id));
  if (availableCards.length === 0) {
    statusEl.textContent = 'No remaining cards available for auto-add.';
    return;
  }

  const minCardsToAdd = Math.max(0, contract.minCards - existingCardCount);
  const projectionBaseMelds = (state.tableMelds || []).map((m) => ({
    type: m.type,
    cards: [...(m.cards || [])],
  }));
  if (current && current.details) {
    current.details.forEach((d) => {
      if (d.valid && d.type && Array.isArray(d.cards)) {
        projectionBaseMelds.push({ type: d.type, cards: [...d.cards] });
      }
    });
  }

  const best = findBestOpeningAddition(
    availableCards,
    needSets,
    needRuns,
    minCardsToAdd,
    projectionBaseMelds,
  );
  if (!best || !best.melds || best.melds.length === 0) {
    statusEl.textContent = 'No valid auto-add combination found for opening.';
    return;
  }

  const handOrderIndex = new Map(handOrderIds.map((id, idx) => [id, idx]));
  best.melds.forEach((m) => {
    const orderedIds = [...(m.cards || []).map((c) => c.id)].sort((a, b) => {
      const ai = handOrderIndex.has(a) ? handOrderIndex.get(a) : Number.MAX_SAFE_INTEGER;
      const bi = handOrderIndex.has(b) ? handOrderIndex.get(b) : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
    pendingMelds.push({ cardIds: orderedIds });
  });

  statusEl.textContent = `Added ${best.melds.length} suggested meld(s) (${best.totalOpenCards} open cards incl. +${best.addedToOpenCount} expansion, ~${best.projectedLayoffCount} projected layoff). Review and adjust if needed.`;
  render();
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
    const hostTag = idx === 0 ? ' (host)' : '';
    li.textContent = `${idx + 1}. ${p.name}${hostTag}${dealerTag}${turnTag} | hand: ${p.handCount} | score: ${p.score}${openTag}`;
    playersListEl.appendChild(li);
  });
}

function renderHand() {
  handCardsEl.innerHTML = '';
  if (!state || !state.yourHand) return;

  syncHandOrder();
  layoffOptionsByCard = computeLayoffOptionsByCard();
  const cardById = new Map(state.yourHand.map((c) => [c.id, c]));
  const visibleOrder = dealAnimation.active ? handOrderIds.slice(0, dealAnimation.visibleCount) : handOrderIds;

  visibleOrder.forEach((cardId) => {
    const card = cardById.get(cardId);
    if (!card) return;

    const div = document.createElement('button');
    div.type = 'button';
    div.className = 'hand-card';
    if (selectedCardIds.has(card.id)) div.classList.add('selected');
    if (layoffOptionsByCard.has(card.id)) div.classList.add('layoff-candidate');
    if (dealAnimation.active && dealAnimation.latestRevealedId === card.id) {
      div.classList.add('dealing-enter');
    }
    if (dragPlacement.targetId === card.id) {
      div.classList.add(dragPlacement.mode === 'after' ? 'drop-after' : 'drop-before');
    }
    div.title = longCardLabel(card);
    div.draggable = !dealAnimation.active;
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

    div.addEventListener('click', (event) => {
      if (dealAnimation.active) return;
      const wasSelected = selectedCardIds.has(card.id);
      if (event.shiftKey) {
        applyRangeSelection(card.id);
      } else if (wasSelected) {
        selectedCardIds.delete(card.id);
        lastClickedCardId = card.id;
      } else {
        selectedCardIds.add(card.id);
        lastClickedCardId = card.id;
      }
      quickLayoffCardId = (selectedCardIds.has(card.id) && layoffOptionsByCard.has(card.id)) ? card.id : null;
      renderHand();
      renderQuickLayoffActions();
      syncControls();
    });

    div.addEventListener('dragstart', (event) => {
      if (dealAnimation.active) return;
      draggedCardId = card.id;
      draggedCardIds = getDraggedGroup(card.id);
      div.classList.add('dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', card.id);
      }
    });

    div.addEventListener('dragend', () => {
      draggedCardId = null;
      draggedCardIds = [];
      clearDragPlacement();
      div.classList.remove('dragging');
      renderHand();
    });

    div.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (dealAnimation.active) return;
      const rect = div.getBoundingClientRect();
      const mode = event.clientX > rect.left + (rect.width / 2) ? 'after' : 'before';
      if (dragPlacement.targetId !== card.id || dragPlacement.mode !== mode) {
        dragPlacement = { targetId: card.id, mode };
        renderHand();
      }
    });

    div.addEventListener('drop', (event) => {
      if (dealAnimation.active) return;
      event.preventDefault();
      const targetId = card.id;
      const sourceId = draggedCardId || (event.dataTransfer ? event.dataTransfer.getData('text/plain') : '');
      if (!sourceId || sourceId === targetId) return;

      const movingIds = draggedCardIds.length > 0 ? [...draggedCardIds] : [sourceId];
      if (movingIds.includes(targetId)) return;

      const sourceIndex = handOrderIds.indexOf(sourceId);
      const targetIndex = handOrderIds.indexOf(targetId);
      if (sourceIndex === -1 || targetIndex === -1) return;

      const movingSet = new Set(movingIds);
      handOrderIds = handOrderIds.filter((id) => !movingSet.has(id));

      const adjustedTargetIndex = handOrderIds.indexOf(targetId);
      if (adjustedTargetIndex === -1) return;

      const insertIndex = dragPlacement.mode === 'after' ? adjustedTargetIndex + 1 : adjustedTargetIndex;
      handOrderIds.splice(insertIndex, 0, ...movingIds);
      clearDragPlacement();
      renderHand();
    });

    handCardsEl.appendChild(div);
  });
}

function removeCardFromPendingMeld(meldIndex, cardId) {
  const meld = pendingMelds[meldIndex];
  if (!meld) return;

  meld.cardIds = meld.cardIds.filter((id) => id !== cardId);
  if (meld.cardIds.length === 0) {
    pendingMelds.splice(meldIndex, 1);
  }
  render();
}

function removePendingMeld(meldIndex) {
  if (meldIndex < 0 || meldIndex >= pendingMelds.length) return;
  pendingMelds.splice(meldIndex, 1);
  render();
}

function addSelectedCardsToPendingMeld(meldIndex) {
  const meld = pendingMelds[meldIndex];
  if (!meld) return;
  const chosen = selectedCards();
  if (chosen.length === 0) return;

  const chosenIds = chosen.map((c) => c.id);
  const chosenSet = new Set(chosenIds);

  // Keep card usage unique across pending melds.
  pendingMelds.forEach((m, idx) => {
    if (idx === meldIndex) return;
    m.cardIds = m.cardIds.filter((id) => !chosenSet.has(id));
  });
  pendingMelds = pendingMelds.filter((m, idx) => idx === meldIndex || m.cardIds.length > 0);

  const existing = new Set(meld.cardIds);
  chosenIds.forEach((id) => {
    if (!existing.has(id)) meld.cardIds.push(id);
  });

  chosenIds.forEach((id) => selectedCardIds.delete(id));
  render();
}

function renderPendingMelds() {
  if (pendingMelds.length === 0) {
    pendingMeldsEl.textContent = 'No pending melds yet.';
    pendingOpenAnalysis = null;
    return;
  }

  const handById = new Map((state && state.yourHand ? state.yourHand : []).map((c) => [c.id, c]));
  pendingOpenAnalysis = analyzePendingOpenMelds();
  pendingMeldsEl.innerHTML = '';

  pendingMelds.forEach((m, i) => {
    const detail = pendingOpenAnalysis ? pendingOpenAnalysis.details[i] : null;
    const statusClass = detail && detail.valid ? 'pending-ok' : 'pending-bad';
    const statusText = detail
      ? (detail.valid ? `Valid ${String(detail.type || '').toUpperCase()}` : `Invalid: ${detail.reason}`)
      : 'Waiting for validation';

    const row = document.createElement('div');
    row.className = 'pending-meld-row';

    const title = document.createElement('strong');
    title.textContent = `Meld ${i + 1}:`;
    row.appendChild(title);

    const cardsRow = document.createElement('div');
    cardsRow.className = 'pending-meld-cards';
    m.cardIds.forEach((id) => {
      const card = handById.get(id);
      if (!card) return;
      const cardBtn = document.createElement('button');
      cardBtn.type = 'button';
      cardBtn.className = 'pending-card-btn';
      cardBtn.title = `Remove ${longCardLabel(card)} from meld`;

      const img = makeCardImage(card, 'card-face mini');
      img.addEventListener('error', () => {
        const span = document.createElement('span');
        span.textContent = cardLabel(card);
        cardBtn.innerHTML = '';
        cardBtn.appendChild(span);
      });

      const remove = document.createElement('span');
      remove.className = 'pending-card-remove';
      remove.textContent = '×';

      cardBtn.appendChild(img);
      cardBtn.appendChild(remove);
      cardBtn.addEventListener('click', () => {
        removeCardFromPendingMeld(i, card.id);
      });
      cardsRow.appendChild(cardBtn);
    });
    row.appendChild(cardsRow);

    const actions = document.createElement('div');
    actions.className = 'pending-meld-actions';

    const addSelectedBtn = document.createElement('button');
    addSelectedBtn.type = 'button';
    addSelectedBtn.className = 'secondary';
    addSelectedBtn.textContent = 'Add Selected';
    addSelectedBtn.disabled = selectedCardIds.size === 0;
    addSelectedBtn.addEventListener('click', () => {
      addSelectedCardsToPendingMeld(i);
    });
    actions.appendChild(addSelectedBtn);

    const removeMeldBtn = document.createElement('button');
    removeMeldBtn.type = 'button';
    removeMeldBtn.className = 'warn';
    removeMeldBtn.textContent = 'Remove Meld';
    removeMeldBtn.addEventListener('click', () => {
      removePendingMeld(i);
    });
    actions.appendChild(removeMeldBtn);
    row.appendChild(actions);

    const status = document.createElement('div');
    status.className = `pending-meld-status ${statusClass}`;
    status.textContent = statusText;
    row.appendChild(status);

    pendingMeldsEl.appendChild(row);
  });

  if (pendingOpenAnalysis) {
    const a = pendingOpenAnalysis;
    const contractLine = document.createElement('div');
    contractLine.className = 'pending-contract';
    contractLine.textContent = `Contract: ${a.contract.label} (min ${a.contract.minCards} cards). Current: ${a.setCount} set(s), ${a.runCount} run(s), ${a.cardCount} card(s).`;
    pendingMeldsEl.appendChild(contractLine);

    const statusLine = document.createElement('div');
    statusLine.className = `pending-contract ${a.canOpen ? 'pending-ok' : 'pending-bad'}`;
    statusLine.textContent = a.canOpen ? 'Ready to open.' : `Cannot open yet: ${a.contractReason}`;
    pendingMeldsEl.appendChild(statusLine);
  }
}

function renderTableMelds() {
  if (!state || !state.tableMelds || state.tableMelds.length === 0) {
    if (tableMeldsPanel) tableMeldsPanel.classList.add('hidden');
    tableMeldsEl.textContent = 'No melds on table yet.';
    return;
  }
  if (tableMeldsPanel) tableMeldsPanel.classList.remove('hidden');

  tableMeldsEl.innerHTML = '';

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
  });
}

function renderPlayerHandFans() {
  if (!playerHandFansEl) return;
  playerHandFansEl.innerHTML = '';

  if (!state || !Array.isArray(state.players) || state.players.length === 0) return;
  const others = state.players.filter((p) => p.id !== state.yourId);
  if (others.length === 0) return;
  const seatPresets = {
    1: [
      { left: 50, top: 14 }, // opposite
    ],
    2: [
      { left: 18, top: 34 }, // left side
      { left: 82, top: 34 }, // right side
    ],
    3: [
      { left: 18, top: 34 }, // left side
      { left: 50, top: 14 }, // opposite
      { left: 82, top: 34 }, // right side
    ],
    4: [
      { left: 16, top: 34 }, // left side
      { left: 36, top: 14 }, // top-left
      { left: 64, top: 14 }, // top-right
      { left: 84, top: 34 }, // right side
    ],
  };
  const positions = seatPresets[others.length] || seatPresets[4];

  others.forEach((p, idx) => {
    const box = document.createElement('div');
    box.className = 'player-fan';
    if (p.id === state.turnPlayerId) box.classList.add('turn');

    const header = document.createElement('div');
    header.className = 'player-fan-header';
    const name = document.createElement('span');
    const turnTag = p.id === state.turnPlayerId ? ' • Turn' : '';
    name.textContent = `${p.name}${turnTag}`;
    const countEl = document.createElement('span');
    countEl.className = 'fan-count';
    countEl.textContent = `${p.handCount} card${p.handCount === 1 ? '' : 's'}`;
    header.appendChild(name);
    header.appendChild(countEl);
    box.appendChild(header);

    const fan = document.createElement('div');
    fan.className = 'mini-fan';
    const total = Math.max(0, Number(p.handCount) || 0);
    const shown = Math.min(total, 13);
    const spread = shown > 1 ? Math.max(8, Math.floor(72 / (shown - 1))) : 0;
    const fanWidth = shown > 0 ? 30 + ((shown - 1) * spread) : 30;
    fan.style.width = `${fanWidth}px`;

    for (let i = 0; i < shown; i += 1) {
      const card = document.createElement('img');
      card.className = 'mini-fan-card';
      card.src = '/images/card_back.png';
      card.alt = 'Card back';
      card.style.left = `${i * spread}px`;
      card.style.zIndex = String(i + 1);
      fan.appendChild(card);
    }
    box.appendChild(fan);

    const pos = positions[idx] || positions[positions.length - 1];
    box.style.left = `${pos.left}%`;
    box.style.top = `${pos.top}%`;

    playerHandFansEl.appendChild(box);
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

function renderTurnVisuals() {
  if (!state || !turnBadge || !handPanel) return;

  if (state.phase !== 'inRound') {
    turnBadge.classList.remove('active', 'yours');
    handPanel.classList.remove('your-turn');
    return;
  }

  const turnPlayer = state.players.find((p) => p.id === state.turnPlayerId);
  const isMine = state.turnPlayerId === state.yourId;
  const label = isMine ? 'Your Turn' : `${turnPlayer ? turnPlayer.name : 'Player'}'s Turn`;
  turnBadge.textContent = label;
  turnBadge.classList.add('active');
  turnBadge.classList.toggle('yours', isMine);
  handPanel.classList.toggle('your-turn', isMine);
}

function hideRoundOverlay() {
  if (roundOverlay) roundOverlay.classList.remove('active');
}

function renderRoundSummary() {
  if (!state || !state.roundSummary || !roundOverlay) {
    hideRoundOverlay();
    return;
  }

  if (state.phase !== 'roundSummary' && state.phase !== 'finished') {
    hideRoundOverlay();
    return;
  }

  const summary = state.roundSummary;
  const roundWinner = summary.rows.find((r) => r.id === summary.winnerId);
  const roundWinnerName = roundWinner ? roundWinner.name : 'Unknown';
  const bonusText = summary.winnerBonus === -10 ? ' (opened and went out: -10 bonus)' : '';

  roundSummaryTitle.textContent = `Round ${summary.round} Summary`;

  let meta = `Round winner: ${roundWinnerName}${bonusText}`;
  if (summary.isFinalRound) {
    const winners = summary.rows
      .filter((r) => (summary.gameWinnerIds || []).includes(r.id))
      .map((r) => r.name);
    if (winners.length > 0) {
      meta += ` | Game winner: ${winners.join(', ')}`;
    }
  }
  roundSummaryMeta.textContent = meta;

  const maxTotal = Math.max(...summary.rows.map((r) => Math.max(0, r.totalScore)), 1);
  const rowsHtml = summary.rows.map((r) => {
    const width = Math.max(0, Math.round((Math.max(0, r.totalScore) / maxTotal) * 100));
    const isGameWinner = summary.isFinalRound && (summary.gameWinnerIds || []).includes(r.id);
    const winnerBadge = isGameWinner ? '<span class="winner-badge">Winner</span>' : '';
    return `
      <tr class="${isGameWinner ? 'winner-row' : ''}">
        <td>${r.name}${winnerBadge}</td>
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

  roundSummaryHands.innerHTML = '';
  summary.rows.forEach((r) => {
    const box = document.createElement('div');
    box.className = 'hand-review';

    const title = document.createElement('div');
    title.className = 'hand-review-title';
    title.textContent = `${r.name} | Hand points: ${r.handPoints}`;
    box.appendChild(title);

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'review-cards';

    if (!r.handCards || r.handCards.length === 0) {
      const none = document.createElement('span');
      none.className = 'small';
      none.textContent = 'No cards left';
      cardsWrap.appendChild(none);
    } else {
      r.handCards.forEach((card) => {
        const img = makeCardImage(card, 'card-face mini');
        img.addEventListener('error', () => {
          const fallback = document.createElement('span');
          fallback.textContent = cardLabel(card);
          img.replaceWith(fallback);
        });
        cardsWrap.appendChild(img);
      });
    }

    box.appendChild(cardsWrap);
    roundSummaryHands.appendChild(box);
  });

  const isRoundSummary = state.phase === 'roundSummary' && summary.canContinue;
  continueRoundBtn.classList.toggle('hidden', !isRoundSummary);
  continueRoundBtn.disabled = !state.isHost;

  const isFinished = state.phase === 'finished';
  endGameBtn.classList.toggle('hidden', !isFinished);

  roundOverlay.classList.add('active');
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

function clearClaimAnnouncement() {
  if (claimAnnouncementTimer) {
    clearTimeout(claimAnnouncementTimer);
    claimAnnouncementTimer = null;
  }
  claimAnnouncementClearAfterSerial = null;
  if (claimAnnouncementEl) {
    claimAnnouncementEl.classList.remove('active');
    claimAnnouncementEl.innerHTML = '';
  }
}

function showClaimAnnouncement(payload) {
  if (!claimAnnouncementEl || !payload || !payload.card) return;

  clearClaimAnnouncement();
  claimAnnouncementClearAfterSerial = Number(payload.clearAfterDiscardSerial);

  claimAnnouncementEl.innerHTML = '';
  const label = document.createElement('span');
  label.textContent = `${payload.playerName} took:`;
  claimAnnouncementEl.appendChild(label);

  const img = makeCardImage(payload.card, 'card-face mini');
  img.addEventListener('error', () => {
    const fallback = document.createElement('span');
    fallback.textContent = cardLabel(payload.card);
    img.replaceWith(fallback);
  });
  claimAnnouncementEl.appendChild(img);
  claimAnnouncementEl.classList.add('active');

  claimAnnouncementTimer = setTimeout(() => {
    clearClaimAnnouncement();
  }, 5000);
}

function syncControls() {
  pruneSelectionToCurrentHand();

  const inLobby = state && state.phase === 'lobby';
  const stageDraw = state && state.turnStage === 'draw';
  const stageDiscard = state && state.turnStage === 'discard';
  const inSummary = state && state.phase === 'roundSummary';
  const dealing = dealAnimation.active;
  const handCount = state && state.yourHand ? state.yourHand.length : 0;
  const isLastCardClose = Boolean(canActOnTurn() && stageDiscard && handCount === 1);

  const playerCount = state && state.players ? state.players.length : 0;
  startGameBtn.textContent = `Start Game (${playerCount}/${state ? state.maxPlayers : 5})`;
  startGameBtn.disabled = !inLobby || !state || !state.isHost || playerCount < 2;

  stockPileBtn.disabled = dealing || !canActOnTurn() || !stageDraw || !state || state.stockCount < 1;

  const canDrawDiscard = canActOnTurn() && stageDraw && state && state.discardTop;
  const canClaimDiscard = state
    && state.phase === 'inRound'
    && !isYourTurn()
    && state.discardClaimOpen
    && !state.discardClaimedByMe;
  discardPileBtn.disabled = dealing || !(canDrawDiscard || canClaimDiscard);

  discardBtn.textContent = isLastCardClose ? 'Close' : 'Discard Selected';
  discardBtn.disabled = dealing || !canActOnTurn() || !stageDiscard || (!isLastCardClose && selectedCardIds.size !== 1);
  sortSuitBtn.disabled = dealing || !state || state.phase !== 'inRound';
  sortNumberBtn.disabled = dealing || !state || state.phase !== 'inRound';
  addPendingMeldBtn.disabled = dealing || !canActOnTurn() || !stageDiscard || selectedCardIds.size < 3;
  suggestOpenBtn.disabled = dealing || !canActOnTurn() || !stageDiscard || youOpened();
  clearPendingBtn.disabled = dealing || pendingMelds.length === 0;
  const canOpenByPreview = pendingOpenAnalysis ? pendingOpenAnalysis.canOpen : false;
  openBtn.disabled = dealing || !canActOnTurn() || !stageDiscard || pendingMelds.length === 0 || youOpened() || !canOpenByPreview;

  if (!inSummary) continueRoundBtn.disabled = true;

  if (!state || state.phase !== 'inRound') {
    selectedCardIds.clear();
    pendingMelds = [];
  }
}

function render() {
  renderLayout();
  renderLobbyPlayers();
  renderRoundInfo();
  renderTurnVisuals();
  renderPiles();
  renderPlayerHandFans();
  renderPlayers();
  renderHand();
  renderQuickLayoffActions();
  renderPendingMelds();
  renderTableMelds();
  renderRoundSummary();
  syncControls();

  if (
    state
    && claimAnnouncementClearAfterSerial !== null
    && Number.isFinite(state.discardSerial)
    && state.discardSerial >= claimAnnouncementClearAfterSerial
  ) {
    clearClaimAnnouncement();
  }

  if (!state || state.phase !== 'inRound') {
    clearClaimAnnouncement();
    quickLayoffCardId = null;
  }
}

createRoomBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) {
    landingStatus.textContent = 'Enter your name first.';
    return;
  }
  localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
  socket.emit('createRoom', { name, playerToken });
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
  localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
  localStorage.setItem(LAST_ROOM_STORAGE_KEY, code);
  socket.emit('joinRoom', { roomCode: code, name, playerToken });
});

startGameBtn.addEventListener('click', () => {
  socket.emit('startGame');
});

leaveLobbyBtn.addEventListener('click', () => {
  socket.emit('leaveRoom');
});

copyRoomCodeBtn.addEventListener('click', async () => {
  const code = String(joinedRoomCode || '').trim();
  if (!code) {
    statusEl.textContent = 'No room code available to copy.';
    return;
  }

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(code);
    } else {
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    statusEl.textContent = `Room code ${code} copied to clipboard.`;
  } catch (_err) {
    statusEl.textContent = 'Could not copy room code. Copy it manually.';
  }
});

bgToggleBtn.addEventListener('click', () => {
  const currentIdx = getBackgroundIndexById(backgroundChoice);
  const nextIdx = currentIdx >= 0
    ? (currentIdx + 1) % BACKGROUND_OPTIONS.length
    : 0;
  applyBackgroundChoice(BACKGROUND_OPTIONS[nextIdx].id, true);
});

continueRoundBtn.addEventListener('click', () => {
  socket.emit('continueRound');
});

endGameBtn.addEventListener('click', () => {
  socket.emit('leaveRoom');
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
    statusEl.textContent = 'Discard claim registered. Precedence follows turn order.';
  }
});

discardBtn.addEventListener('click', () => {
  if (!state || !state.yourHand) return;

  const stageDiscard = state.turnStage === 'discard';
  const isLastCardClose = canActOnTurn() && stageDiscard && state.yourHand.length === 1;
  let cardId = null;

  if (isLastCardClose) {
    cardId = state.yourHand[0].id;
  } else {
    const chosen = selectedCards();
    if (chosen.length !== 1) return;
    cardId = chosen[0].id;
  }

  selectedCardIds.clear();
  socket.emit('discard', { cardId });
});

sortSuitBtn.addEventListener('click', () => {
  sortHandOneTime('suit');
});

sortNumberBtn.addEventListener('click', () => {
  sortHandOneTime('number');
});

addPendingMeldBtn.addEventListener('click', () => {
  const cards = selectedCards();
  if (cards.length < 3) return;
  const cardIds = cards.map((c) => c.id);
  pendingMelds.push({ cardIds });
  cardIds.forEach((id) => selectedCardIds.delete(id));
  render();
});

suggestOpenBtn.addEventListener('click', () => {
  suggestBestOpenMelds();
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

socket.on('connect', () => {
  const knownRoomCode = joinedRoomCode || sanitizeCode(localStorage.getItem(LAST_ROOM_STORAGE_KEY) || '');
  const playerName = nameInput.value.trim();
  if (knownRoomCode && playerName) {
    landingStatus.textContent = `Reconnecting to room ${knownRoomCode}...`;
    socket.emit('joinRoom', { roomCode: knownRoomCode, name: playerName, playerToken });
    return;
  }
  landingStatus.textContent = 'Connected. Create or join a room.';
});

socket.on('roomJoined', ({ roomCode }) => {
  joinedRoomCode = roomCode;
  localStorage.setItem(LAST_ROOM_STORAGE_KEY, roomCode);
  landingStatus.textContent = `Joined room ${roomCode}.`;
  renderLayout();
});

socket.on('leftRoom', () => {
  resetToLanding('Returned to landing page.');
});

socket.on('discardPickupAnnouncement', (payload) => {
  showClaimAnnouncement(payload);
});

socket.on('state', (nextState) => {
  const previousState = state;
  state = nextState;
  maybeStartDealAnimation(previousState, nextState);
  if (state.roomCode) {
    joinedRoomCode = state.roomCode;
    localStorage.setItem(LAST_ROOM_STORAGE_KEY, state.roomCode);
  }
  render();

  if (state.phase === 'lobby') {
    statusEl.textContent = state.isHost
      ? 'Waiting for players. Click Start Game when ready.'
      : 'Waiting for host to start the game.';
  } else if (state.phase === 'finished') {
    statusEl.textContent = 'Game finished. Review results and click End Game.';
  } else if (state.winnerOfHand) {
    const winner = state.players.find((p) => p.id === state.winnerOfHand);
    if (winner) statusEl.textContent = `${winner.name} ended the hand.`;
  }
});

socket.on('gameError', (message) => {
  if (message === 'Room not found.') {
    localStorage.removeItem(LAST_ROOM_STORAGE_KEY);
    if (!joinedRoomCode) roomCodeInput.value = '';
  }
  if (!joinedRoomCode) landingStatus.textContent = message;
  else statusEl.textContent = message;
});

applyBackgroundChoice(backgroundChoice, false);
