const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { blackCards, whiteCards } = require('./cards');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

// Spielstatus
const games = new Map();

class Game {
  constructor(gameId) {
    this.gameId = gameId;
    this.players = [];
    this.blackCardDeck = [...blackCards].sort(() => Math.random() - 0.5);
    this.whiteCardDeck = [...whiteCards].sort(() => Math.random() - 0.5);
    this.currentBlackCard = null;
    this.czarIndex = 0;
    this.submissions = new Map();
    this.scores = new Map();
    this.phase = 'waiting'; // waiting, playing, judging, round_end
    this.round = 0;
    this.lastWinner = null;
  }

  addPlayer(playerId, playerName) {
    if (this.players.find(p => p.id === playerId)) return;
    
    const hand = [];
    for (let i = 0; i < 7; i++) {
      if (this.whiteCardDeck.length > 0) {
        hand.push(this.whiteCardDeck.pop());
      }
    }
    
    this.players.push({ id: playerId, name: playerName, hand });
    this.scores.set(playerId, 0);
  }

  removePlayer(playerId) {
    const playerIndex = this.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;
    
    // Adjust czar index if necessary
    if (playerIndex < this.czarIndex) {
      this.czarIndex--;
    } else if (playerIndex === this.czarIndex && this.players.length > 1) {
      this.czarIndex = this.czarIndex % (this.players.length - 1);
    }
    
    this.players = this.players.filter(p => p.id !== playerId);
    this.submissions.delete(playerId);
  }

  startRound() {
    if (this.players.length < 3) return false;
    
    this.phase = 'playing';
    this.round++;
    this.submissions.clear();
    this.lastWinner = null;
    
    if (this.blackCardDeck.length === 0) {
      this.blackCardDeck = [...blackCards].sort(() => Math.random() - 0.5);
    }
    
    this.currentBlackCard = this.blackCardDeck.pop();
    return true;
  }

  submitCard(playerId, card) {
    if (this.phase !== 'playing') return false;
    if (this.getCurrentCzar().id === playerId) return false;
    if (this.submissions.has(playerId)) return false; // Already submitted
    
    this.submissions.set(playerId, card);
    
    const player = this.players.find(p => p.id === playerId);
    if (player) {
      player.hand = player.hand.filter(c => c !== card);
      if (this.whiteCardDeck.length > 0) {
        player.hand.push(this.whiteCardDeck.pop());
      }
    }
    
    // Alle haben abgegeben?
    const nonCzarPlayers = this.players.filter(p => p.id !== this.getCurrentCzar().id);
    if (this.submissions.size === nonCzarPlayers.length) {
      this.phase = 'judging';
    }
    
    return true;
  }

  selectWinner(playerId) {
    if (this.phase !== 'judging') return false;
    if (!this.submissions.has(playerId)) return false;
    
    const currentScore = this.scores.get(playerId) || 0;
    this.scores.set(playerId, currentScore + 1);
    
    this.lastWinner = playerId;
    this.phase = 'round_end';
    return true;
  }

  nextRound() {
    this.czarIndex = (this.czarIndex + 1) % this.players.length;
    return this.startRound();
  }

  getCurrentCzar() {
    return this.players[this.czarIndex];
  }

  getGameState(playerId) {
    const player = this.players.find(p => p.id === playerId);
    const isCzar = this.getCurrentCzar()?.id === playerId;
    
    // Shuffle submissions for anonymity during judging
    let submissionsArray = null;
    if (this.phase === 'judging' || this.phase === 'round_end') {
      submissionsArray = Array.from(this.submissions.entries()).map(([pid, card]) => ({
        playerId: this.phase === 'round_end' ? pid : null,
        playerName: this.phase === 'round_end' ? this.players.find(p => p.id === pid)?.name : null,
        card,
        isWinner: this.phase === 'round_end' && pid === this.lastWinner
      }));
      
      // Shuffle only during judging phase
      if (this.phase === 'judging') {
        submissionsArray.sort(() => Math.random() - 0.5);
      }
    }
    
    return {
      gameId: this.gameId,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        score: this.scores.get(p.id) || 0,
        isCzar: this.getCurrentCzar()?.id === p.id,
        hasSubmitted: this.submissions.has(p.id)
      })),
      hand: player?.hand || [],
      currentBlackCard: this.currentBlackCard,
      phase: this.phase,
      isCzar,
      round: this.round,
      submissions: submissionsArray,
      submissionCount: this.submissions.size,
      totalSubmissionsNeeded: this.players.length - 1,
      lastWinner: this.phase === 'round_end' ? this.players.find(p => p.id === this.lastWinner)?.name : null
    };
  }
}

io.on('connection', (socket) => {
  console.log('Spieler verbunden:', socket.id);

  socket.on('createGame', ({ playerName }, callback) => {
    const gameId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const game = new Game(gameId);
    game.addPlayer(socket.id, playerName);
    games.set(gameId, game);
    
    socket.join(gameId);
    callback({ success: true, gameId });
    io.to(gameId).emit('gameState', game.getGameState(socket.id));
  });

  socket.on('joinGame', ({ gameId, playerName }, callback) => {
    const game = games.get(gameId);
    if (!game) {
      callback({ success: false, error: 'Spiel nicht gefunden' });
      return;
    }
    
    if (game.players.length >= 10) {
      callback({ success: false, error: 'Spiel ist voll (max. 10 Spieler)' });
      return;
    }
    
    game.addPlayer(socket.id, playerName);
    socket.join(gameId);
    callback({ success: true, gameId });
    
    // Allen Spielern den neuen Status senden
    game.players.forEach(player => {
      io.to(player.id).emit('gameState', game.getGameState(player.id));
    });
  });

  socket.on('startRound', ({ gameId }) => {
    const game = games.get(gameId);
    if (!game) return;
    
    if (game.startRound()) {
      game.players.forEach(player => {
        io.to(player.id).emit('gameState', game.getGameState(player.id));
      });
    }
  });

  socket.on('submitCard', ({ gameId, card }) => {
    const game = games.get(gameId);
    if (!game) return;
    
    if (game.submitCard(socket.id, card)) {
      game.players.forEach(player => {
        io.to(player.id).emit('gameState', game.getGameState(player.id));
      });
    }
  });

  socket.on('selectWinner', ({ gameId, playerId }) => {
    const game = games.get(gameId);
    if (!game) return;
    
    // Verify the requesting player is the czar
    if (game.getCurrentCzar().id !== socket.id) return;
    
    if (game.selectWinner(playerId)) {
      game.players.forEach(player => {
        io.to(player.id).emit('gameState', game.getGameState(player.id));
      });
    }
  });

  socket.on('nextRound', ({ gameId }) => {
    const game = games.get(gameId);
    if (!game) return;
    
    game.nextRound();
    game.players.forEach(player => {
      io.to(player.id).emit('gameState', game.getGameState(player.id));
    });
  });

  socket.on('disconnect', () => {
    console.log('Spieler getrennt:', socket.id);
    
    // Spieler aus allen Spielen entfernen
    games.forEach((game, gameId) => {
      const hadPlayer = game.players.find(p => p.id === socket.id);
      
      if (hadPlayer) {
        game.removePlayer(socket.id);
        
        if (game.players.length === 0) {
          games.delete(gameId);
          console.log('Spiel gelöscht:', gameId);
        } else {
          // Inform remaining players
          game.players.forEach(player => {
            io.to(player.id).emit('gameState', game.getGameState(player.id));
          });
          
          // If we're in the middle of a round and not enough players, reset
          if (game.players.length < 3 && game.phase !== 'waiting') {
            game.phase = 'waiting';
            game.round = 0;
            game.submissions.clear();
            game.players.forEach(player => {
              io.to(player.id).emit('gameState', game.getGameState(player.id));
            });
          }
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
