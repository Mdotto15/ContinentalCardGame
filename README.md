# Continental Card Game (Web Multiplayer)

Browser-based multiplayer Continental-style Rummy built with Node.js, Express, and Socket.IO.

## What This Build Supports

- Room-code multiplayer: create a room or join by code.
- Up to **5 simultaneous players per room**.
- Lobby flow: join room -> host starts game.
- 7-round contract progression:
  1. Two sets
  2. One set + one run
  3. Two runs
  4. Three sets
  5. Two sets + one run
  6. One set + two runs
  7. Three runs
- Cards dealt by round: 7 (round 1), 8 (round 2), ... up to 13 (round 7).
- Deck count scales with players (e.g. 5 players => 3 decks) with jokers.
- Wild cards: jokers + red aces.
- Turn system: draw first (stock/discard), then either open valid contract melds and/or discard exactly one card.
- Opening validation against the current round contract.
- Layoff onto existing table melds once a player has opened.
- Hand ending when a player goes out; penalty scoring for remaining cards.

## Scoring

- Number cards score their face value.
- J/Q/K/10 = 10 points.
- Ace = 20 points.
- Joker = 50 points.
- If a player opens and goes out in the same turn, that player gets a `-10` round bonus.
- Lowest total score after round 7 wins.

## Install & Run

```bash
npm install
npm start
```

Open `http://localhost:3000` in up to 5 browser tabs/windows.

## Room Flow

1. Enter your name on the landing page.
2. Click `Create Room` to host and share the generated code, or enter a code and click `Join Room`.
3. Host clicks `Start Game` from the room lobby when at least 2 players are present.

## Notes

This implementation follows the linked Continental Rummy structure and contracts, with a practical simplification:
- "May I?" out-of-turn discard claiming is not implemented yet.
- At the end of each round, a score summary graphic is shown with round and total scores before continuing.

If you want, the next step can be adding full "May I?" priority/penalty draw behavior.
