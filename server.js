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
        centerIndex: room.centerIndex,
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
  room.centerIndex = 0;
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
  broadcastRoomState(roomCode);
  checkBotTurn(roomCode);
          }

