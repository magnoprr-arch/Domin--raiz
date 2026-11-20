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
        currentTurn: room.currentTurn,
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

  const deck = createDeck();
  room.board = [];
  room.leftEnd = null;
  room.rightEnd = null;
  room.consecutivePasses = 0;
  room.started = true;
  room.roundEnded = false;
  room.roundSummary = '';

  for (let i = 0; i < 4; i++) {
    if (room.chips[i] <= 0) room.chips[i] = 100;
    room.hands[i] = deck.slice(i * 7, (i + 1) * 7);
  }

  let starter = 0;
  for (let i = 0; i < 4; i++) {
    if (room.hands[i].some(t => t.a === 6 && t.b === 6)) {
      starter = i;
      break;
    }
  }

  room.currentTurn = starter;
  room.status = `Partida iniciada! Vez de ${room.players[starter].name}`;
  broadcastRoomState(roomCode);
  checkBotTurn(roomCode);
}

function checkBotTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.started) return;

  const currentPlayer = room.players[room.currentTurn];
  if (currentPlayer && currentPlayer.isBot) {
    setTimeout(() => {
      if (!rooms[roomCode] || !rooms[roomCode].started) return;
      const moves = getValidMoves(room, room.currentTurn);
      if (moves.length === 0) {
        processPass(roomCode, room.currentTurn);
      } else {
        const firstMove = moves.shift();
        processMove(roomCode, room.currentTurn, firstMove.idx, firstMove.side);
      }
    }, 1100);
  }
}

function processMove(roomCode, seatIndex, tileIndex, side) {
  const room = rooms[roomCode];
  if (!room || !room.started || room.currentTurn !== seatIndex) return;

  const validMoves = getValidMoves(room, seatIndex);
  const chosen = validMoves.find(m => m.idx === tileIndex && m.side === side);
  
  if (!chosen) {
    const p = room.players[seatIndex];
    if (p && p.socketId) {
      io.to(p.socketId).emit('toast', '⚠️ Proibido fechar o jogo tendo outra peça disponível!');
    }
    return;
  }

  const removed = room.hands[seatIndex].splice(tileIndex, 1);
  const tile = removed.shift();
  room.consecutivePasses = 0;

  if (room.board.length === 0) {
    room.board.push({ a: tile.a, b: tile.b });
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
    room.started = false;
    room.roundEnded = true;
    room.roundSummary = `🏆 ${room.players[seatIndex].name} BATEU o jogo e levou +${prize} fichas!`;
    room.status = room.roundSummary;
    io.to(roomCode).emit('playSound', 'win');
    broadcastRoomState(roomCode);
    return;
  }

  room.currentTurn = (room.currentTurn + 1) % 4;
  room.status = `Vez de ${room.players[room.currentTurn].name}`;
  broadcastRoomState(roomCode);
  checkBotTurn(roomCode);
}

function processPass(roomCode, seatIndex) {
  const room = rooms[roomCode];
  if (!room || !room.started || room.currentTurn !== seatIndex) return;

  const validMoves = getValidMoves(room, seatIndex);
  if (validMoves.length > 0) return;

  room.consecutivePasses++;
  io.to(roomCode).emit('playSound', 'pass');
  let msg = `${room.players[seatIndex].name} passou!`;

  if (room.config.gameMode === 'pass_pay') {
    const prevSeat = (seatIndex + 3) % 4;
    const amount = Math.min(room.chips[seatIndex], room.config.passCost);
    room.chips[seatIndex] -= amount;
    room.chips[prevSeat] += amount;
    msg += ` Pagou ${amount} fichas para ${room.players[prevSeat].name}.`;
  }

  if (room.consecutivePasses >= 4) {
    let minPts = Infinity;
    let winner = 0;
    for (let i = 0; i < 4; i++) {
      const pts = room.hands[i].reduce((s, t) => s + t.a + t.b, 0);
      if (pts < minPts) {
        minPts = pts;
        winner = i;
      }
    }
    const prize = room.config.passCost * 4;
    room.chips[winner] += prize;
    room.wins[winner] += 1;
    room.started = false;
    room.roundEnded = true;
    room.roundSummary = `🔒 Jogo Trancado! ${room.players[winner].name} venceu (${minPts} pts) e ganhou +${prize} fichas!`;
    room.status = room.roundSummary;
    io.to(roomCode).emit('playSound', 'win');
    broadcastRoomState(roomCode);
    return;
  }

  room.currentTurn = (room.currentTurn + 1) % 4;
  room.status = `${msg} Vez de ${room.players[room.currentTurn].name}`;
  broadcastRoomState(roomCode);
  checkBotTurn(roomCode);
}

io.on('connection', (socket) => {
  socket.on('validateVip', (code, callback) => {
    const clean = (code || '').trim().toUpperCase();
    callback(VALID_VIP_CODES.includes(clean));
  });

  socket.on('createRoom', ({ playerName, insta, isVip, gameMode, passCost, startChips }) => {
    const code = generateRoomCode();
    const cleanInsta = (insta || '').replace('@', '').trim();
    rooms[code] = {
      players: [{ name: playerName || 'Anfitrião', insta: cleanInsta, isVip: !!isVip, socketId: socket.id, isBot: false }, null, null, null],
      chips: [startChips, startChips, startChips, startChips],
      wins: new Array(4).fill(0),
      hands: [[], [], [], []],
      board: [],
      leftEnd: null,
      rightEnd: null,
      currentTurn: 0,
      consecutivePasses: 0,
      started: false,
      roundEnded: false,
      roundSummary: '',
      status: `Sala ${code} criada! Convide seus amigos.`,
      config: { gameMode, passCost: parseInt(passCost) || 10 }
    };
    socket.join(code);
    broadcastRoomState(code);
  });

  socket.on('joinRoom', ({ roomCode, playerName, insta, isVip }) => {
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) {
      socket.emit('errorMsg', 'Sala não encontrada ou já encerrada!');
      return;
    }
    const emptySeat = room.players.findIndex(p => p === null);
    if (emptySeat === -1) {
      socket.emit('errorMsg', 'A mesa já está cheia (4 jogadores)!');
      return;
    }
    const cleanInsta = (insta || '').replace('@', '').trim();
    room.players[emptySeat] = { name: playerName || `Jogador ${emptySeat + 1}`, insta: cleanInsta, isVip: !!isVip, socketId: socket.id, isBot: false };
    socket.join(code);
    room.status = `${playerName} sentou na mesa!`;
    broadcastRoomState(code);
  });

  socket.on('startGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;
    for (let i = 0; i < 4; i++) {
      if (room.players[i] === null) {
        room.players[i] = { name: `Bot ${i + 1}`, insta: '', isVip: false, socketId: null, isBot: true };
      }
    }
    startRound(roomCode);
  });

          
