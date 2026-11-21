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

