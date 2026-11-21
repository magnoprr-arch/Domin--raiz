const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const VALID_VIP_CODES = ['DONO2026', 'VIPDOMINO', 'MESTRE01', 'REI100'];

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function createDeck() {
  const deck = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      deck.push({ a: i, b: j });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function willCloseGame(board, leftEnd, rightEnd, tile, side) {
  if (board.length === 0) return false;
  let newLeft = leftEnd;
  let newRight = rightEnd;
  if (side === 'left') {
    newLeft = (tile.a === leftEnd) ? tile.b : tile.a;
  } else {
    newRight = (tile.a === rightEnd) ? tile.b : tile.a;
  }
  if (newLeft !== newRight) return false;
  const targetNum = newLeft;
  let count = 1;
  for (let t of board) {
    if (t.a === targetNum || t.b === targetNum) count++;
  }
  return count >= 7;
}

function getValidMoves(room, seatIndex) {
  const hand = room.hands[seatIndex];
  let allMoves = [];
  hand.forEach((tile, idx) => {
    if (room.board.length === 0) {
      allMoves.push({ idx, tile, side: 'left', closes: false });
    } else {
      const fitLeft = tile.a === room.leftEnd || tile.b === room.leftEnd;
      const fitRight = tile.a === room.rightEnd || tile.b === room.rightEnd;
      if (fitLeft) {
        allMoves.push({ idx, tile, side: 'left', closes: willCloseGame(room.board, room.leftEnd, room.rightEnd, tile, 'left') });
      }
      if (fitRight && (room.leftEnd !== room.rightEnd || !fitLeft)) {
        allMoves.push({ idx, tile, side: 'right', closes: willCloseGame(room.board, room.leftEnd, room.rightEnd, tile, 'right') });
      }
    }
  });
  const nonClosing = allMoves.filter(m => !m.closes);
  return nonClosing.length > 0 ? nonClosing : allMoves;
}

function chooseBestBotMove(room, seatIndex, moves) {
  const hand = room.hands[seatIndex];
  const suitCount = new Array(7).fill(0);
  hand.forEach(t => {
    suitCount[t.a]++;
    if (t.a !== t.b) suitCount[t.b]++;
  });

  // Verifica quem joga logo depois deste Bot e quais naipes essa pessoa ja passou
  const nextSeat = (seatIndex + 1) % 4;
  const nextPassed = (room.passedSuits && room.passedSuits[nextSeat]) ? room.passedSuits[nextSeat] : [];

  let bestMove = moves.slice(0, 1).pop();
  let bestScore = -999;

  moves.forEach(m => {
    let score = (m.tile.a + m.tile.b) * 2;
    if (m.tile.a === m.tile.b) score += 12;
    if (m.closes) score -= 50;

    let exposed = m.tile.a;
    if (room.board.length > 0) {
      const targetEnd = m.side === 'left' ? room.leftEnd : room.rightEnd;
      exposed = (m.tile.a === targetEnd) ? m.tile.b : m.tile.a;
    }
    score += suitCount[exposed] * 5;

    // Bonus tatico: se o proximo jogador ja passou nesse numero, força o passe dele!
    if (nextPassed.includes(exposed)) {
      score += 20;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
    }
  });

  return bestMove;
}

function clearTurnTimer(room) {
  if (room && room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
}

function scheduleTurnTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.started) return;
  clearTurnTimer(room);

  const seat = room.currentTurn;
  room.turnDeadline = Date.now() + 10000;

  room.turnTimer = setTimeout(() => {
    const r = rooms[roomCode];
    if (!r || !r.started || r.currentTurn !== seat) return;
    const moves = getValidMoves(r, seat);
    if (moves.length === 0) {
      processPass(roomCode, seat);
    } else {
      const randomMove = moves[Math.floor(Math.random() * moves.length)];
      const p = r.players[seat];
      if (p && p.socketId) {
        io.to(p.socketId).emit('toast', '⏱ Tempo esgotado! Jogada automatica.');
      }
      processMove(roomCode, seat, randomMove.idx, randomMove.side);
    }
  }, 10200);
}

function broadcastRoomState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.players.forEach((p, seatIndex) => {
    if (p && p.socketId) {
      io.to(p.socketId).emit('gameState', {
        roomCode,
        players: room.players.map((pl, idx) => ({
          name: pl ? pl.name : 'Aguardando...',
          insta: pl ? pl.insta : '',
          isVip: pl ? pl.isVip : false,
          chips: room.chips[idx],
          wins: room.wins[idx],
          handCount: room.hands[idx] ? room.hands[idx].length : 0,
          isBot: pl ? pl.isBot : false
        })),
        mySeat: seatIndex,
        myHand: room.hands[seatIndex] || [],
        board: room.board,
        centerIndex: room.centerIndex,
        currentTurn: room.currentTurn,
        turnDeadline: room.turnDeadline || 0,
        status: room.status,
        started: room.started,
        roundEnded: room.roundEnded,
        roundSummary: room.roundSummary,
        config: room.config
      });
    }
  });
      }
function startRound(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  clearTurnTimer(room);
  const deck = createDeck();
  room.board = [];
  room.centerIndex = 0;
  room.leftEnd = null;
  room.rightEnd = null;
  room.consecutivePasses = 0;
  room.passedSuits = [[], [], [], []];
  room.started = true;
  room.roundEnded = false;
  room.roundSummary = '';
  for (let i = 0; i < 4; i++) {
    if (room.chips[i] <= 0) room.chips[i] = 100;
    room.hands[i] = deck.slice(i * 7, (i + 1) * 7);
  }
  let starter = room.lastWinner !== null ? room.lastWinner : 0;
  if (room.lastWinner === null) {
    for (let i = 0; i < 4; i++) {
      if (room.hands[i].some(t => t.a === 6 && t.b === 6)) {
        starter = i;
        break;
      }
    }
  }
  room.currentTurn = starter;
  const p = room.players[starter];
  room.status = p.isBot ? ('🤔 ' + p.name + ' pensando...') : ('Sua vez de sair!');
  scheduleTurnTimer(roomCode);
  broadcastRoomState(roomCode);
  checkBotTurn(roomCode);
}

function checkBotTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.started) return;
  const currentPlayer = room.players[room.currentTurn];
  if (currentPlayer && currentPlayer.isBot) {
    const thinkTime = 3500 + Math.floor(Math.random() * 1800);
    setTimeout(() => {
      if (!rooms[roomCode] || !rooms[roomCode].started) return;
      const moves = getValidMoves(room, room.currentTurn);
      if (moves.length === 0) {
        processPass(roomCode, room.currentTurn);
      } else {
        const smartMove = chooseBestBotMove(room, room.currentTurn, moves);
        processMove(roomCode, room.currentTurn, smartMove.idx, smartMove.side);
      }
    }, thinkTime);
  }
}

function processMove(roomCode, seatIndex, tileIndex, side) {
  const room = rooms[roomCode];
  if (!room || !room.started || room.currentTurn !== seatIndex) return;
  const validMoves = getValidMoves(room, seatIndex);
  const chosen = validMoves.find(m => m.idx === tileIndex && m.side === side);
  if (!chosen) {
    const p = room.players[seatIndex];
    if (p && p.socketId) io.to(p.socketId).emit('toast', 'Proibido fechar o jogo!');
    return;
  }
  clearTurnTimer(room);
  const removed = room.hands[seatIndex].splice(tileIndex, 1);
  const tile = removed.shift();
  room.consecutivePasses = 0;
  if (room.board.length === 0) {
    room.board.push({ a: tile.a, b: tile.b });
    room.centerIndex = 0;
    room.leftEnd = tile.a;
    room.rightEnd = tile.b;
  } else if (side === 'left') {
    if (tile.b === room.leftEnd) {
      room.board.unshift({ a: tile.a, b: tile.b });
      room.leftEnd = tile.a;
    } else {
      room.board.unshift({ a: tile.b, b: tile.a });
      room.leftEnd = tile.b;
    }
    room.centerIndex++;
  } else {
    if (tile.a === room.rightEnd) {
      room.board.push({ a: tile.a, b: tile.b });
      room.rightEnd = tile.b;
    } else {
      room.board.push({ a: tile.b, b: tile.a });
      room.rightEnd = tile.a;
    }
  }
  io.to(roomCode).emit('playSound', 'tile');
  if (room.hands[seatIndex].length === 0) {
    const prize = room.config.passCost * 4;
    room.chips[seatIndex] += prize;
    room.wins[seatIndex] += 1;
    room.lastWinner = seatIndex;
    room.started = false;
    room.roundEnded = true;
    room.roundSummary = room.players[seatIndex].name + ' BATEU e ganhou +' + prize + ' fichas!';
    room.status = room.roundSummary;
    io.to(roomCode).emit('playSound', 'win');
    broadcastRoomState(roomCode);
    return;
  }
  room.currentTurn = (room.currentTurn + 1) % 4;
  const nextP = room.players[room.currentTurn];
  room.status = nextP.isBot ? ('🤔 ' + nextP.name + ' pensando...') : ('Sua vez, ' + nextP.name + '!');
  scheduleTurnTimer(roomCode);
  broadcastRoomState(roomCode);
  checkBotTurn(roomCode);
}

function processPass(roomCode, seatIndex) {
  const room = rooms[roomCode];
  if (!room || !room.started || room.currentTurn !== seatIndex) return;
  const validMoves = getValidMoves(room, seatIndex);
  if (validMoves.length > 0) return;
  clearTurnTimer(room);

  // Grava na memoria da mesa os dois naipes que este jogador nao tem
  if (room.passedSuits && room.passedSuits[seatIndex]) {
    if (room.leftEnd !== null && !room.passedSuits[seatIndex].includes(room.leftEnd)) {
      room.passedSuits[seatIndex].push(room.leftEnd);
    }
    if (room.rightEnd !== null && !room.passedSuits[seatIndex].includes(room.rightEnd)) {
      room.passedSuits[seatIndex].push(room.rightEnd);
    }
  }

  room.consecutivePasses++;
  io.to(roomCode).emit('playSound', 'pass');
  let msg = room.players[seatIndex].name + ' passou!';
  if (room.config.gameMode === 'pass_pay') {
    const prevSeat = (seatIndex + 3) % 4;
    const amount = Math.min(room.chips[seatIndex], room.config.passCost);
    room.chips[seatIndex] -= amount;
    room.chips[prevSeat] += amount;
    msg += ' Pagou ' + amount + '.';
  }
  if (room.consecutivePasses >= 4) {
    let minPts = Infinity;
    let winner = 0;
    for (let i = 0; i < 4; i++) {
      const pts = room.hands[i].reduce((s, t) => s + t.a + t.b, 0);
      if (pts < minPts) { minPts = pts; winner = i; }
    }
    const prize = room.config.passCost * 4;
    room.chips[winner] += prize;
    room.wins[winner] += 1;
    room.lastWinner = winner;
    room.started = false;
    room.roundEnded = true;
    room.roundSummary = 'Jogo Trancado! ' + room.players[winner].name + ' venceu (' + minPts + ' pts)!';
    room.status = room.roundSummary;
    io.to(roomCode).emit('playSound', 'win');
    broadcastRoomState(roomCode);
    return;
  }
  room.currentTurn = (room.currentTurn + 1) % 4;
  const nextP = room.players[room.currentTurn];
  room.status = msg + (nextP.isBot ? (' 🤔 ' + nextP.name + ' pensando...') : (' Sua vez!'));
  scheduleTurnTimer(roomCode);
  broadcastRoomState(roomCode);
  checkBotTurn(roomCode);
}

io.on('connection', (socket) => {
  socket.on('validateVip', (code, callback) => {
    callback(VALID_VIP_CODES.includes((code || '').trim().toUpperCase()));
  });
  socket.on('createRoom', ({ playerName, insta, isVip, gameMode, passCost, startChips }) => {
    const code = generateRoomCode();
    const cleanInsta = (insta || '').replace('@', '').trim();
    rooms[code] = {
      players: [{ name: playerName || 'Anfitriao', insta: cleanInsta, isVip: !!isVip, socketId: socket.id, isBot: false }, null, null, null],
      chips: [startChips, startChips, startChips, startChips],
      wins: new Array(4).fill(0),
      lastWinner: null,
      passedSuits: [[], [], [], []],
      turnTimer: null,
      turnDeadline: 0,
      hands: [[], [], [], []],
      board: [], centerIndex: 0, leftEnd: null, rightEnd: null,
      currentTurn: 0, consecutivePasses: 0,
      started: false, roundEnded: false, roundSummary: '',
      status: 'Sala ' + code + ' criada!',
      config: { gameMode, passCost: parseInt(passCost) || 10 }
    };
    socket.join(code);
    broadcastRoomState(code);
  });
  socket.on('joinRoom', ({ roomCode, playerName, insta, isVip }) => {
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) return socket.emit('errorMsg', 'Sala nao encontrada!');
    const emptySeat = room.players.findIndex(p => p === null);
    if (emptySeat === -1) return socket.emit('errorMsg', 'Mesa cheia!');
    const cleanInsta = (insta || '').replace('@', '').trim();
    room.players[emptySeat] = { name: playerName || 'Jogador', insta: cleanInsta, isVip: !!isVip, socketId: socket.id, isBot: false };
    socket.join(code);
    room.status = playerName + ' sentou na mesa!';
    broadcastRoomState(code);
  });
  socket.on('startGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;
    for (let i = 0; i < 4; i++) {
      if (room.players[i] === null) room.players[i] = { name: 'Bot ' + (i + 1), insta: '', isVip: false, socketId: null, isBot: true };
    }
    startRound(roomCode);
  });
  socket.on('playTile', ({ roomCode, tileIndex, side }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const seat = room.players.findIndex(p => p && p.socketId === socket.id);
    if (seat !== -1) processMove(roomCode, seat, tileIndex, side);
  });
  socket.on('passTurn', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const seat = room.players.findIndex(p => p && p.socketId === socket.id);
    if (seat !== -1) processPass(roomCode, seat);
  });
  socket.on('quickEmoji', ({ roomCode, emoji }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const seat = room.players.findIndex(p => p && p.socketId === socket.id);
    if (seat !== -1) io.to(roomCode).emit('showEmoji', { name: room.players[seat].name, emoji });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Servidor online na porta ' + PORT));
      

