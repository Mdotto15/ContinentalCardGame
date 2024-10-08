const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path'); // Correctly import the path module

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

  suits.forEach(suit => {
    ranks.forEach(rank => {
      deck.push({ rank, suit });
    });
  });

  return deck;
}

function createTwoDecks() {
  return [...createDeck(), ...createDeck()]; // Create two decks
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function dealCards(deck, hands, handSize) {
  Object.keys(hands).forEach(playerId => {
    hands[playerId] = deck.splice(0, handSize);
  });
}

function startNewRound() {
  gameState.deck = shuffleDeck(createTwoDecks());
  gameState.openedCards = [];
  gameState.playersOpened = [];
  drawPile = [...gameState.deck];
  discardPile = [];
}

function getCurrentPlayer() {
  return turnOrder[currentTurnIndex];
}

function advanceTurn() {
  currentTurnIndex = (currentTurnIndex + 1) % players.length;
  io.emit('playerTurn', { playerId: getCurrentPlayer() }); // Notify clients of the next player's turn
}

function checkMelds(hand, meldRequirements) {
  // Implement your logic to check trios and runs
  return true; // Replace with actual validation logic
}

function checkOpeningRequirements(playerId) {
  // Implement your logic to check if the player's opened cards meet the requirements
  return true; // Replace with actual validation logic
}

function checkActionButtons(playerId) {
  // Implement your logic to determine which action buttons should be enabled
  io.emit('updateActionButtons', { playerId });
}

server.listen(3000, () => {
  console.log('Server is running on port 3000');
});
