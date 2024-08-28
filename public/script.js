const socket = io();

const dealBtn = document.getElementById('dealBtn');
const playerHandDiv = document.getElementById('playerHand');
const statusDiv = document.getElementById('status');
const scoreBoardDiv = document.getElementById('scoreBoard');

socket.on('connect', () => {
  console.log('Connected to the server');
});

socket.on('updatePlayers', (players) => {
  statusDiv.innerHTML = `Players connected: ${players.length}`;
});

socket.on('gameFull', () => {
  statusDiv.innerHTML = 'Game is full. Please try again later.';
});

socket.on('gameState', (gameState) => {
  // Render player hand
  renderHand(gameState.hands[socket.id]);
});

socket.on('cardPlayed', ({ playerId, card }) => {
  statusDiv.innerHTML = `Player ${playerId} played ${card.rank} of ${card.suit}`;
});

socket.on('scoreUpdate', (scores) => {
  renderScores(scores);
});

dealBtn.addEventListener('click', () => {
  socket.emit('dealCards');
});

function renderHand(hand) {
  playerHandDiv.innerHTML = '';
  hand.forEach(card => {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.innerHTML = `${card.rank} of ${card.suit}`;
    cardDiv.addEventListener('click', () => {
      socket.emit('playCard', card);
      cardDiv.style.display = 'none'; // Remove card from UI
    });
    playerHandDiv.appendChild(cardDiv);
  });
}

function renderScores(scores) {
  scoreBoardDiv.innerHTML = '<h3>Scoreboard</h3>';
  for (const playerId in scores) {
    const scoreDiv = document.createElement('div');
    scoreDiv.innerHTML = `Player ${playerId}: ${scores[playerId]} points`;
    scoreBoardDiv.appendChild(scoreDiv);
  }
}
