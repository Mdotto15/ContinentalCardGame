const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('~/Documents/Continental/ContinentalCardGame'); 

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from the /public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html at the root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let players = [];
let gameState = {
  round: 1,
  maxRounds: 7,
  deck: [],
  hands: {},
  scores: {},
  roundScores: {},
  meldRequirements: [
    { trios: 2, runs: 0 },   // Round 1: 2 trios of 3
    { trios: 1, runs: 1 },   // Round 2: 1 set of 3, 1 run of 4
    { trios: 0, runs: 2 },   // Round 3: 2 runs of 4
    { trios: 3, runs: 0 },   // Round 4: 3 trios of 3
    { trios: 1, runs: 2 },   // Round 5: 1 set of 3, 2 runs of 4
    { trios: 2, runs: 1 },   // Round 6: 2 trios of 3, 1 run of 4
    { trios: 0, runs: 3 },   // Round 7: 3 runs of 4
  ],
  openedCards: [],
  playersOpened: []
};

const db = new sqlite3.Database(':memory:');

db.serialize(() => {
  db.run("CREATE TABLE ongoing_scores (player_id TEXT, score INTEGER)");
  db.run("CREATE TABLE completed_scores (player_id TEXT, score INTEGER)");
});

let turnOrder = [];
let currentTurnIndex = 0;
let drawPile = [];
let discardPile = [];

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  if (players.length < 5) {
    players.push(socket.id);
    turnOrder.push(socket.id); // Add new player to the turn order
    gameState.hands[socket.id] = [];
    gameState.scores[socket.id] = 0;
    gameState.roundScores[socket.id] = 0;
    io.emit('updatePlayers', players);
    io.emit('updateTurnOrder', turnOrder); // Notify clients of the updated turn order
  } else {
    socket.emit('gameFull');
  }

  socket.on('startRound', () => {
    if (gameState.round <= gameState.maxRounds) {
      startNewRound(); // Start a new round and update turn order
      const handSize = 6 + gameState.round;
      gameState.deck = shuffleDeck(createTwoDecks());
      dealCards(gameState.deck, gameState.hands, handSize);
      io.emit('newRound', { round: gameState.round, hands: gameState.hands });
      io.emit('playerTurn', { playerId: getCurrentPlayer() }); // Notify clients of the current player's turn
    }
  });

  socket.on('drawCard', () => {
    if (socket.id === getCurrentPlayer()) { // Check if it's the player's turn
      if (drawPile.length > 0) {
        const card = drawPile.pop();
        gameState.hands[socket.id].push(card); // Add card to player's hand
        io.emit('cardDrawn', { playerId: socket.id, card });
        io.emit('updateDrawPile', drawPile.length); // Update draw pile count

        checkActionButtons(socket.id); // Check if the player can open, close, or only discard
      }
    } else {
      socket.emit('notYourTurn'); // Notify the player that it's not their turn
    }
  });

  socket.on('takeCard', () => {
    if (socket.id === getCurrentPlayer()) { // Check if it's the player's turn
      if (discardPile.length > 0) {
        const card = discardPile.pop();
        gameState.hands[socket.id].push(card); // Add card to player's hand
        io.emit('cardTaken', { playerId: socket.id, card });

        checkActionButtons(socket.id); // Check if the player can open, close, or only discard
      }
    } else {
      socket.emit('notYourTurn'); // Notify the player that it's not their turn
    }
  });

  socket.on('discardCard', (card) => {
    if (socket.id === getCurrentPlayer()) { // Check if it's the player's turn
      const playerHand = gameState.hands[socket.id];
      const cardIndex = playerHand.findIndex(c => c.rank === card.rank && c.suit === card.suit);
      if (cardIndex !== -1) {
        playerHand.splice(cardIndex, 1); // Remove card from player's hand
        discardPile.push(card); // Add card to discard pile
        io.emit('cardDiscarded', { playerId: socket.id, card });
        io.emit('updateDiscardPile', discardPile.length); // Update discard pile count

        advanceTurn(); // Move to the next player's turn after discarding
      }
    } else {
      socket.emit('notYourTurn'); // Notify the player that it's not their turn
    }
  });

  socket.on('open', () => {
    if (socket.id === getCurrentPlayer()) {
      gameState.isOpening = true;
      io.emit('updateGameState', gameState);
    }
  });

  // Handling card selection during opening
  socket.on('selectCardForOpening', (card) => {
    if (gameState.isOpening) {
      gameState.openedCards.push({
        ...card,
        playerId: socket.id
      });
      // Remove the selected card from the player's hand
      const cardIndex = gameState.hands[socket.id].findIndex(
        (c) => c.rank === card.rank && c.suit === card.suit
      );
      if (cardIndex > -1) {
        gameState.hands[socket.id].splice(cardIndex, 1);
      }
  
      io.emit('updateGameState', gameState);
      
      // After selecting cards, validate if they meet the opening requirements
      if (checkOpeningRequirements(socket.id)) {
        io.emit('openValid', socket.id); // Notify that the opening is valid
        gameState.playersOpened.push(socket.id);
        io.emit('showPostOpenActions', socket.id);
      } else {
        socket.emit('invalidOpening'); // Notify that the opening is invalid
      }
    }
  });

  socket.on('close', () => {
    if (socket.id === getCurrentPlayer()) { // Check if it's the player's turn
      const currentMeldReq = gameState.meldRequirements[gameState.round - 1];
      if (checkMelds(gameState.hands[socket.id], currentMeldReq)) {
        gameState.scores[socket.id] += gameState.roundScores[socket.id];
        db.run("INSERT INTO ongoing_scores (player_id, score) VALUES (?, ?)", [socket.id, gameState.scores[socket.id]]);
        gameState.round += 1;

        if (gameState.round > gameState.maxRounds) {
          for (const playerId of players) {
            db.run("INSERT INTO completed_scores (player_id, score) VALUES (?, ?)", [playerId, gameState.scores[playerId]]);
          }
          io.emit('gameOver', gameState.scores);
        } else {
          for (const playerId of players) {
            gameState.roundScores[playerId] = 0;
          }
          io.emit('nextRound', gameState.round);
        }
        advanceTurn(); // Move to the next player's turn
      } else {
        socket.emit('invalidClose'); // Notify the player that they can't close
      }
    } else {
      socket.emit('notYourTurn'); // Notify the player that it's not their turn
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    players = players.filter(id => id !== socket.id);
    turnOrder = turnOrder.filter(id => id !== socket.id); // Remove player from turn order
    delete gameState.hands[socket.id];
    delete gameState.scores[socket.id];
    delete gameState.roundScores[socket.id];
    io.emit('updatePlayers', players);
    io.emit('updateTurnOrder', turnOrder); // Notify clients of the updated turn order
  });
});

function createDeck() {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank });
    }
  }

  deck.push({ suit: 'joker', rank: 'Joker' });
  deck.push({ suit: 'joker', rank: 'Joker' });

  return deck;
}

function createTwoDecks() {
  return [...createDeck(), ...createDeck()];
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function dealCards(deck, hands, handSize) {
  for (const playerId of Object.keys(hands)) {
    hands[playerId] = [];
    for (let i = 0; i < handSize; i++) {
      hands[playerId].push(deck.pop());
    }
  }
}

function checkMelds(hand, meldReq) {
    let trios = 0;
    let runs = 0;
  
    // Function to check if a set is a valid trio
    function isValidTrio(set) {
        const normalCards = set.filter(card => card.rank !== 'Joker');
        const jokerCount = set.length - normalCards.length;
        return normalCards.length + jokerCount >= 3 && new Set(normalCards.map(card => card.rank)).size === 1;
      }
  
    // Function to check if a run is valid
    function isValidRun(run) {
        if (run.length < 4) return false; // Runs must be at least 4 cards long
        run.sort((a, b) => {
          const rankOrder = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
          return rankOrder.indexOf(a.rank) - rankOrder.indexOf(b.rank);
        });
      
        const jokerCount = run.filter(card => card.rank === 'Joker').length;
        let gapCount = 0;
      
        for (let i = 1; i < run.length; i++) {
          const currentRankIndex = rankOrder.indexOf(run[i].rank);
          const previousRankIndex = rankOrder.indexOf(run[i - 1].rank);
          if (currentRankIndex - previousRankIndex !== 1) {
            gapCount += (currentRankIndex - previousRankIndex - 1);
          }
        }
      
        return gapCount <= jokerCount;
      }
  
    // Split hand into sets and runs
    function splitHand(hand) {
        const cardGroups = {};
        const wildCardSets = [];
        const wildCardRuns = [];
        
        // Group cards by rank
        hand.forEach(card => {
          if (!cardGroups[card.rank]) cardGroups[card.rank] = [];
          cardGroups[card.rank].push(card);
        });
      
        // Identify trios
        for (const rank in cardGroups) {
          const group = cardGroups[rank];
          if (isValidTrio(group)) {
            trios += 1;
            cardGroups[rank] = [];
          } else {
            wildCardSets.push(group);
          }
        }
      
        // Identify runs (excluding wild cards for now)
        const allCards = hand.filter(card => card.rank !== 'Joker');
        let currentRun = [];
        for (const card of allCards) {
          if (currentRun.length === 0 || isValidRun([...currentRun, card])) {
            currentRun.push(card);
          } else {
            if (currentRun.length >= 4) {
              runs += 1;
              wildCardRuns.push(currentRun);
            }
            currentRun = [card];
          }
        }
        if (currentRun.length >= 4) {
          runs += 1;
          wildCardRuns.push(currentRun);
        }
      
        return { trios, runs, wildCardSets, wildCardRuns };
      }
      
  
    // Check if the hand meets the meld requirements
    const canOpen = handTrios >= meldReq.trios && handRuns >= meldReq.runs;
  
    // Check for wild card use
    if (handWildCardSets.length > 0 || handWildCardRuns.length > 0) {
      // Validate if wild cards can be used correctly
      const wildCardValidation = handWildCardSets.every(set => set.length === 3) && handWildCardRuns.every(run => run.length >= 3);
      return canOpen && wildCardValidation ? 1 : 0;
    }
  
    return canOpen ? 1 : 0;
  }

// Function to check if the player's selected cards meet the opening requirements
function checkOpeningRequirements(playerId) {
  const currentMeldReq = gameState.meldRequirements[gameState.round - 1];
  const openedCards = gameState.openedCards.filter(card => card.playerId === playerId);

  const { trios, runs } = splitHand(openedCards);

  // Ensure the player meets the requirements for trios and runs for the current round
  return trios >= currentMeldReq.trios && runs >= currentMeldReq.runs;
}

// Function to split a hand into trios and runs
function splitHand(hand) {
  let trios = 0;
  let runs = 0;

  // Example logic for counting trios
  const rankGroups = groupByRank(hand);
  for (let group of Object.values(rankGroups)) {
    if (group.length >= 3) {
      trios += 1;
    }
  }

  // Example logic for counting runs
  const suitGroups = groupBySuit(hand);
  for (let group of Object.values(suitGroups)) {
    const sortedGroup = group.sort((a, b) => cardValue(a.rank) - cardValue(b.rank));
    if (isRun(sortedGroup)) {
      runs += 1;
    }
  }

  return { trios, runs };
}

// Helper function to group cards by rank
function groupByRank(cards) {
  return cards.reduce((acc, card) => {
    acc[card.rank] = acc[card.rank] || [];
    acc[card.rank].push(card);
    return acc;
  }, {});
}

// Helper function to group cards by suit
function groupBySuit(cards) {
  return cards.reduce((acc, card) => {
    acc[card.suit] = acc[card.suit] || [];
    acc[card.suit].push(card);
    return acc;
  }, {});
}

// Helper function to determine if a group of cards is a run
function isRun(cards) {
  for (let i = 1; i < cards.length; i++) {
    if (cardValue(cards[i].rank) !== cardValue(cards[i - 1].rank) + 1) {
      return false;
    }
  }
  return true;
}

// Helper function to get the value of a card rank
function cardValue(rank) {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  return parseInt(rank, 10);
}


function checkActionButtons(playerId) {
  const hand = gameState.hands[playerId];
  const meldReq = gameState.meldRequirements[gameState.round - 1];

  const canOpen = checkMelds(hand, meldReq);
  const canClose = hand.length === 1; // Ensure that only 1 card remains after valid melds for closing

  io.emit('updateActionButtons', { playerId, canOpen, canClose, canDiscard: true }); // Enable or disable buttons for the player
}

function getCurrentPlayer() {
  return turnOrder[currentTurnIndex];
}

function advanceTurn() {
  currentTurnIndex = (currentTurnIndex + 1) % turnOrder.length;
  io.emit('playerTurn', { playerId: getCurrentPlayer() }); // Notify clients of the next player's turn
}

server.listen(3000, () => {
  console.log('Server is running on port 3000');
});
