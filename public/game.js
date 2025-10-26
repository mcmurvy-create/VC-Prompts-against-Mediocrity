const socket = io();

let currentGameId = null;
let currentState = null;
let selectedCard = null;

// Elements
const startScreen = document.getElementById('startScreen');
const gameScreen = document.getElementById('gameScreen');
const playerNameInput = document.getElementById('playerName');
const gameIdInput = document.getElementById('gameIdInput');
const createGameBtn = document.getElementById('createGameBtn');
const joinGameBtn = document.getElementById('joinGameBtn');
const leaveGameBtn = document.getElementById('leaveGameBtn');
const gameIdDisplay = document.getElementById('gameId');
const roundInfo = document.getElementById('roundInfo');
const playersDiv = document.getElementById('players');
const blackCard = document.getElementById('blackCard');
const gameStatus = document.getElementById('gameStatus');
const handDiv = document.getElementById('hand');
const handArea = document.getElementById('handArea');
const submissionsArea = document.getElementById('submissionsArea');
const submissionsDiv = document.getElementById('submissions');
const actionsDiv = document.getElementById('actions');

// Event Listeners
createGameBtn.addEventListener('click', createGame);
joinGameBtn.addEventListener('click', joinGame);
leaveGameBtn.addEventListener('click', leaveGame);

// Enter key support
playerNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') createGame();
});

gameIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinGame();
});

// Auto-uppercase for game ID
gameIdInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
});

function createGame() {
    const playerName = playerNameInput.value.trim();
    if (!playerName) {
        alert('Bitte gib deinen Namen ein!');
        playerNameInput.focus();
        return;
    }
    
    createGameBtn.disabled = true;
    createGameBtn.textContent = 'Erstelle Spiel...';
    
    socket.emit('createGame', { playerName }, (response) => {
        if (response.success) {
            currentGameId = response.gameId;
            showGameScreen();
        } else {
            alert(response.error || 'Fehler beim Erstellen');
            createGameBtn.disabled = false;
            createGameBtn.textContent = 'Neues Spiel erstellen';
        }
    });
}

function joinGame() {
    const playerName = playerNameInput.value.trim();
    const gameId = gameIdInput.value.trim().toUpperCase();
    
    if (!playerName || !gameId) {
        alert('Bitte gib deinen Namen und den Spiel-Code ein!');
        if (!playerName) playerNameInput.focus();
        else gameIdInput.focus();
        return;
    }
    
    joinGameBtn.disabled = true;
    joinGameBtn.textContent = 'Trete bei...';
    
    socket.emit('joinGame', { gameId, playerName }, (response) => {
        if (response.success) {
            currentGameId = response.gameId;
            showGameScreen();
        } else {
            alert(response.error || 'Fehler beim Beitreten');
            joinGameBtn.disabled = false;
            joinGameBtn.textContent = 'Spiel beitreten';
        }
    });
}

function leaveGame() {
    if (confirm('Möchtest du das Spiel wirklich verlassen?')) {
        location.reload();
    }
}

function showGameScreen() {
    startScreen.style.display = 'none';
    gameScreen.style.display = 'block';
    gameIdDisplay.textContent = `Code: ${currentGameId}`;
}

// Socket Events
socket.on('gameState', (state) => {
    currentState = state;
    updateUI(state);
});

socket.on('connect_error', () => {
    alert('Verbindung zum Server fehlgeschlagen. Bitte lade die Seite neu.');
});

socket.on('disconnect', () => {
    if (currentGameId) {
        alert('Verbindung zum Server verloren. Bitte lade die Seite neu.');
    }
});

function updateUI(state) {
    // Update round info
    if (state.round > 0) {
        roundInfo.textContent = `Runde ${state.round}`;
    } else {
        roundInfo.textContent = 'Lobby';
    }
    
    // Update players
    playersDiv.innerHTML = state.players.map(p => `
        <div class="player ${p.isCzar ? 'czar' : ''}">
            <div class="player-name">${escapeHtml(p.name)} ${p.isCzar ? '👑' : ''}</div>
            <div class="player-score">🏆 ${p.score} Punkt${p.score !== 1 ? 'e' : ''}</div>
            ${state.phase === 'playing' && !p.isCzar ? 
                `<div class="player-status">${p.hasSubmitted ? '✓ Abgegeben' : '⏳ Wartet...'}</div>` 
                : ''}
        </div>
    `).join('');
    
    // Update black card
    if (state.currentBlackCard) {
        blackCard.textContent = state.currentBlackCard;
    } else {
        blackCard.textContent = 'Warte auf Rundenstart...';
    }
    
    // Update status
    updateStatus(state);
    
    // Update hand
    if (state.isCzar) {
        handArea.style.display = 'none';
    } else {
        handArea.style.display = 'block';
        updateHand(state);
    }
    
    // Update submissions
    if (state.isCzar && (state.phase === 'judging' || state.phase === 'round_end')) {
        submissionsArea.style.display = 'block';
        updateSubmissions(state);
    } else {
        submissionsArea.style.display = 'none';
    }
    
    // Update actions
    updateActions(state);
}

function updateStatus(state) {
    let statusText = '';
    let statusClass = '';
    
    switch (state.phase) {
        case 'waiting':
            if (state.players.length < 3) {
                statusText = `⏳ Warte auf Spieler... (${state.players.length}/3 minimum)`;
                statusClass = 'waiting';
            } else {
                statusText = '✅ Bereit zum Starten!';
                statusClass = 'waiting';
            }
            break;
        case 'playing':
            if (state.isCzar) {
                statusText = `👑 Du bist der Prompt Master! Warte auf Antworten... (${state.submissionCount}/${state.totalSubmissionsNeeded})`;
                statusClass = 'playing';
            } else {
                statusText = '🎴 Wähle deine beste Karte aus!';
                statusClass = 'playing';
            }
            break;
        case 'judging':
            if (state.isCzar) {
                statusText = '⭐ Wähle den Gewinner!';
                statusClass = 'judging';
            } else {
                statusText = '⏳ Warte auf die Entscheidung des Prompt Masters...';
                statusClass = 'judging';
            }
            break;
        case 'round_end':
            if (state.lastWinner) {
                statusText = `🎉 ${escapeHtml(state.lastWinner)} hat diese Runde gewonnen!`;
            } else {
                statusText = 'Runde beendet!';
            }
            statusClass = 'judging';
            break;
    }
    
    gameStatus.textContent = statusText;
    gameStatus.className = `game-status ${statusClass}`;
}

function updateHand(state) {
    const isPlaying = state.phase === 'playing';
    const hasSubmitted = state.players.find(p => p.id === socket.id)?.hasSubmitted;
    
    handDiv.innerHTML = state.hand.map(card => {
        const isDisabled = !isPlaying || hasSubmitted;
        const isSelected = selectedCard === card;
        
        return `
            <div class="card card-white ${isDisabled ? 'disabled' : ''} ${isSelected ? 'selected' : ''}" 
                 data-card="${escapeHtml(card)}"
                 onclick="selectCard('${escapeHtml(card).replace(/'/g, "\\'")}')">
                ${escapeHtml(card)}
            </div>
        `;
    }).join('');
}

function updateSubmissions(state) {
    if (!state.submissions) return;
    
    submissionsDiv.innerHTML = state.submissions.map((sub, index) => {
        const isWinner = sub.isWinner;
        const showName = state.phase === 'round_end' && sub.playerName;
        
        return `
            <div class="card card-white ${state.phase === 'round_end' ? 'disabled' : ''} ${isWinner ? 'winner' : ''}" 
                 data-player-id="${sub.playerId || ''}"
                 onclick="selectWinner('${sub.playerId || ''}', ${index})">
                ${escapeHtml(sub.card)}
                ${showName ? `<div class="card-submission-info">von ${escapeHtml(sub.playerName)}</div>` : ''}
                ${isWinner ? '<div class="card-submission-info">⭐ GEWINNER</div>' : ''}
            </div>
        `;
    }).join('');
}

function updateActions(state) {
    actionsDiv.innerHTML = '';
    
    if (state.phase === 'waiting' && state.players.length >= 3) {
        const startBtn = document.createElement('button');
        startBtn.className = 'btn btn-primary';
        startBtn.textContent = '🎮 Runde starten';
        startBtn.onclick = () => {
            startBtn.disabled = true;
            socket.emit('startRound', { gameId: currentGameId });
        };
        actionsDiv.appendChild(startBtn);
    }
    
    if (state.phase === 'round_end') {
        const nextBtn = document.createElement('button');
        nextBtn.className = 'btn btn-primary';
        nextBtn.textContent = '▶️ Nächste Runde';
        nextBtn.onclick = () => {
            nextBtn.disabled = true;
            selectedCard = null;
            socket.emit('nextRound', { gameId: currentGameId });
        };
        actionsDiv.appendChild(nextBtn);
    }
}

function selectCard(card) {
    if (!currentState || currentState.phase !== 'playing' || currentState.isCzar) return;
    
    const player = currentState.players.find(p => p.id === socket.id);
    if (player?.hasSubmitted) return;
    
    selectedCard = card;
    socket.emit('submitCard', { gameId: currentGameId, card });
}

function selectWinner(playerId, index) {
    if (!currentState || currentState.phase !== 'judging' || !currentState.isCzar) return;
    
    // Get the actual player ID from the submission
    if (!playerId && currentState.submissions && currentState.submissions[index]) {
        // During judging, we need to find the player ID
        // We'll store it in a map when we receive submissions
        const allSubmissions = Array.from(currentState.submissions);
        if (allSubmissions[index]) {
            // Find player by matching the card
            const card = allSubmissions[index].card;
            const matchingPlayer = currentState.players.find(p => {
                return !p.isCzar; // Can only be a non-czar player
            });
            
            // Since submissions are shuffled, we need to use the original order
            // This is handled server-side - we just send the index
            socket.emit('selectWinner', { 
                gameId: currentGameId, 
                playerId: getPlayerIdFromSubmissionIndex(index)
            });
        }
    } else if (playerId) {
        socket.emit('selectWinner', { gameId: currentGameId, playerId });
    }
}

function getPlayerIdFromSubmissionIndex(index) {
    // This is a helper to get player ID from submission index
    // The server shuffles submissions during judging phase
    // We need to track the mapping client-side
    if (!currentState || !currentState.submissions || !currentState.submissions[index]) {
        return null;
    }
    
    // During round_end, playerId is revealed
    if (currentState.phase === 'round_end') {
        return currentState.submissions[index].playerId;
    }
    
    // During judging, we create a temporary mapping
    // based on non-czar players order
    const nonCzarPlayers = currentState.players.filter(p => !p.isCzar);
    return nonCzarPlayers[index % nonCzarPlayers.length]?.id;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Store submissions mapping for judging phase
let submissionsMapping = new Map();

socket.on('gameState', (state) => {
    // Create mapping during judging phase
    if (state.phase === 'judging' && state.submissions && state.isCzar) {
        submissionsMapping.clear();
        const nonCzarPlayers = state.players.filter(p => !p.isCzar);
        state.submissions.forEach((sub, idx) => {
            submissionsMapping.set(idx, nonCzarPlayers[idx % nonCzarPlayers.length]?.id);
        });
    }
    
    currentState = state;
    updateUI(state);
});

// Updated selectWinner function
function selectWinner(playerId, index) {
    if (!currentState || currentState.phase !== 'judging' || !currentState.isCzar) return;
    
    // Use the mapping we created
    const actualPlayerId = playerId || submissionsMapping.get(index);
    
    if (actualPlayerId) {
        socket.emit('selectWinner', { gameId: currentGameId, playerId: actualPlayerId });
    }
}
