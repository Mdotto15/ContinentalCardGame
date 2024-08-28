const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

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
};

// SQLite database setup
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
  db.run("CREATE TABLE ongoing_scores (player_id TEXT, score INTEGER)");
  db.run("CREATE TABLE completed_scores (player_id TEXT, score INTEGER)");
});

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  if (players.length < 5) { 
    players.push(socket.id);
    gameState.hands[socket.id] = [];
    gameState.scores[socket.id] = 0; 
    gameState.roundScores[socket.id] = 0;
    io.emit('updatePlayers', players);
  } else {
    socket.emit('gameFull');
  }

  socket.on('startRound', () => {
    if (gameState.round <= gameState.maxRounds) {
      const handSize = 6 + gameState.round; 
      gameState.deck = shuffleDeck(createTwoDecks());
      dealCards(gameState.deck, gameState.hands, handSize);
      io.emit('newRound', { round: gameState.round, hands: gameState.hands });
    }
  });

  //update drawLogic & return to pile
  socket.on('drawCard', (card) => {
    const playerHand = gameState.hands[socket.id];
    const cardIndex = playerHand.indexOf(card);
    if (cardIndex !== -1) {
      playerHand.splice(cardIndex, 1);
      //is update scores needed????
      updateRoundScore(socket.id, card);
      io.emit('cardPlayed', { playerId: socket.id, card });
      io.emit('scoreUpdate', gameState.roundScores);
    }
  });

  //update take card logicfrom pile. include functionality for off turn ie adding card to hand w/out dropping
  socket.on('takeCard', (card) => {
    const playerHand = gameState.hands[socket.id];
    const cardIndex = playerHand.indexOf(card);
    if (cardIndex !== -1) {
      playerHand.splice(cardIndex, 1);
      updateRoundScore(socket.id, card);
      io.emit('cardPlayed', { playerId: socket.id, card });
      io.emit('scoreUpdate', gameState.roundScores);
    }
  });

  //connected to a button that conditionally renders with constant check after card draw
  socket.on('open', () => {
    const currentMeldReq = gameState.meldRequirements[gameState.round - 1];
    for (const playerId of players) {
      if (checkMelds(gameState.hands[playerId], currentMeldReq)) {
        gameState.scores[playerId] += gameState.roundScores[playerId];
        //display cards on "table"
      }
    }
  });

  //connected to a button that conditionally renders with constant check after card draw
  socket.on('close', () => {
    const currentMeldReq = gameState.meldRequirements[gameState.round - 1];
    for (const playerId of players) {
        if (checkMelds(gameState.hands[playerId], currentMeldReq)) {
        gameState.scores[playerId] += gameState.roundScores[playerId];
        db.run("INSERT INTO ongoing_scores (player_id, score) VALUES (?, ?)", [playerId, gameState.scores[playerId]]);
        }
    }

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
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    players = players.filter(id => id !== socket.id);
    delete gameState.hands[socket.id];
    delete gameState.scores[socket.id];
    delete gameState.roundScores[socket.id];
    io.emit('updatePlayers', players);
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
  const deck1 = createDeck();
  const deck2 = createDeck();
  return deck1.concat(deck2);
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
    hands[playerId] = deck.splice(0, handSize);
  }
}

function updateRoundScore(playerId, card) {
  const rankValues = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 10, 'Q': 10, 'K': 10, 'A': 20, 'Joker': 50
  };
  gameState.roundScores[playerId] += rankValues[card.rank] || 0;
}

function checkMelds(hand, meldReq) {
  // Check for required trios and runs
  let trios = 0;
  let runs = 0;

  // check if round requires trios
  if (meldReq.trios >= 1){
    for 

  }
  // check if round requires runs
  if (meldReq.trios >= 1){

  }


  //check if it is possible to open then check if you can close
  //by seeing if added cards can go to opened hands as well.
  //If open only return 1 if both return 2 if none return 0

  //trios >= meldReq.trios && runs >= meldReq.runs;
}



app.use(express.static('public'));

server.listen(3000, () => {
  console.log('Server listening on port 3000');
});



//Possible have deck displayed w/ # of cards on it and use that as draw button
// have pile of cards beside it with memory of prev card connected to take card button
//undo button in case of an error