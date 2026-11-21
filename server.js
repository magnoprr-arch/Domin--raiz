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
    function renderVerticalBoard() {
      const canvas = document.getElementById('board-canvas');
      canvas.innerHTML = '';
      if (!state.board || !state.board.length) return;

      const box = document.getElementById('board-box');
      const boxW = box.clientWidth;
      const boxH = box.clientHeight;

      const scale = state.board.length > 18 ? 0.72 : (state.board.length > 12 ? 0.85 : 1.0);
      const L = Math.floor(62 * scale);
      const S = Math.floor(31 * scale);
      const gap = 2;

      const centerIdx = state.centerIndex || 0;
      const centerTile = state.board[centerIdx];
      const cDbl = centerTile.a === centerTile.b;
      const cw = cDbl ? L : S;
      const ch = cDbl ? S : L;

      const startX = Math.floor(boxW / 2);
      const startY = Math.floor(boxH / 2) + 16;

      const cEl = document.createElement('div');
      cEl.className = 'tile board-tile ' + (cDbl ? 'horiz' : 'vert');
      cEl.style.cssText = 'width:' + cw + 'px;height:' + ch + 'px;left:' + (startX - Math.floor(cw / 2)) + 'px;top:' + (startY - Math.floor(ch / 2)) + 'px;';
      cEl.innerHTML = drawHalf(centerTile.a, cDbl) + drawHalf(centerTile.b, cDbl);
      canvas.appendChild(cEl);

      // Braco de baixo (desce, dobra pra direita, sobe e dobra pra esquerda antes de bater no topo)
      let bx = startX, by = startY + Math.floor(ch / 2) + gap, bDir = 'down';
      for (let i = centerIdx + 1; i < state.board.length; i++) {
        const t = state.board[i], dbl = t.a === t.b;
        let w, h, ori, v1, v2, x, y;
        if (bDir === 'down') {
          w = dbl ? L : S; h = dbl ? S : L; ori = dbl ? 'horiz' : 'vert';
          v1 = t.a; v2 = t.b; x = bx - Math.floor(w / 2); y = by;
          by += h + gap;
          if (by + L > boxH - 12 && i < state.board.length - 1) bDir = 'right';
        } else if (bDir === 'right') {
          w = L; h = S; ori = 'horiz'; v1 = t.a; v2 = t.b;
          x = bx - Math.floor(S / 2); y = by; bx = x + w + gap;
          if (bx + L > boxW - 58 && i < state.board.length - 1) {
            bDir = 'up'; bx = x + w - Math.floor(S / 2); by = y - gap;
          }
        } else if (bDir === 'up') {
          w = dbl ? L : S; h = dbl ? S : L; ori = dbl ? 'horiz' : 'vert';
          v1 = t.b; v2 = t.a; by -= h; x = bx - Math.floor(w / 2); y = by;
          by -= gap;
          if (by - L < 72 && i < state.board.length - 1) {
            bDir = 'leftTop'; bx = x - gap;
          }
        } else {
          w = L; h = S; ori = 'horiz'; v1 = t.b; v2 = t.a;
          x = bx - w; y = by; bx = x - gap;
        }
        const el = document.createElement('div');
        el.className = 'tile board-tile ' + ori;
        el.style.cssText = 'width:' + w + 'px;height:' + h + 'px;left:' + x + 'px;top:' + y + 'px;';
        el.innerHTML = drawHalf(v1, ori === 'horiz') + drawHalf(v2, ori === 'horiz');
        canvas.appendChild(el);
      }

      // Braco de cima (sobe respeitando a barra do topo, dobra pra esquerda e desce)
      let tx = startX, ty = startY - Math.floor(ch / 2) - gap, tDir = 'up';
      for (let i = centerIdx - 1; i >= 0; i--) {
        const t = state.board[i], dbl = t.a === t.b;
        let w, h, ori, v1, v2, x, y;
        if (tDir === 'up') {
          w = dbl ? L : S; h = dbl ? S : L; ori = dbl ? 'horiz' : 'vert';
          v1 = t.a; v2 = t.b; ty -= h; x = tx - Math.floor(w / 2); y = ty;
          ty -= gap;
          if (ty - L < 72 && i > 0) tDir = 'left';
        } else if (tDir === 'left') {
          w = L; h = S; ori = 'horiz'; v1 = t.a; v2 = t.b;
          x = tx + Math.floor(S / 2) - w; y = ty - S; tx = x - gap;
          if (tx - L < 58 && i > 0) {
            tDir = 'down'; tx = x + Math.floor(S / 2); ty = y + S + gap;
          }
        } else {
          w = dbl ? L : S; h = dbl ? S : L; ori = dbl ? 'horiz' : 'vert';
          v1 = t.b; v2 = t.a; x = tx - Math.floor(w / 2); y = ty;
          ty += h + gap;
        }
        const el = document.createElement('div');
        el.className = 'tile board-tile ' + ori;
        el.style.cssText = 'width:' + w + 'px;height:' + h + 'px;left:' + x + 'px;top:' + y + 'px;';
        el.innerHTML = drawHalf(v1, ori === 'horiz') + drawHalf(v2, ori === 'horiz');
        canvas.appendChild(el);
      }
    }

    function renderGame() {
      document.getElementById('top-code').innerText = state.roomCode;
      document.getElementById('top-rule').innerText = state.config.gameMode === 'pass_pay' ? 'Passe: ' + state.config.passCost : 'So Batida';
      document.getElementById('status').innerText = state.status;
      const me = state.mySeat;
      updateSeat('seat-me', me, true);
      updateSeat('seat-right', (me + 1) % 4, false);
      updateSeat('seat-top', (me + 2) % 4, false);
      updateSeat('seat-left', (me + 3) % 4, false);
      renderVerticalBoard();

      const handEl = document.getElementById('hand'); handEl.innerHTML = '';
      state.myHand.forEach((t, idx) => {
        const div = document.createElement('div');
        div.className = 'tile hand'; div.onclick = () => clickTile(idx);
        div.innerHTML = drawHalf(t.a, false) + drawHalf(t.b, false);
        handEl.appendChild(div);
      });

      if (state.started && state.currentTurn === me) {
        const canPlay = state.myHand.some(t => {
          if (!state.board.length) return true;
          const f = state.board.slice(0, 1).pop(), l = state.board.slice(-1).pop();
          return t.a === f.a || t.b === f.a || t.a === l.b || t.b === l.b;
        });
        document.getElementById('btn-pass').style.display = canPlay ? 'none' : 'block';
      } else {
        document.getElementById('btn-pass').style.display = 'none';
        document.getElementById('side-btns').style.display = 'none';
      }
    }

    function updateSeat(id, idx, me) {
      const p = state.players[idx], el = document.getElementById(id);
      el.classList.toggle('active', state.started && state.currentTurn === idx);
      el.innerHTML = '<strong>' + (p.isVip ? '👑 ' : '') + p.name + '</strong><br>' + (me ? '' : 'Pecas: ' + p.handCount + '<br>') + '🏆' + p.wins + ' 💰' + p.chips;
    }

    function clickTile(idx) {
      if (!state.started || state.currentTurn !== state.mySeat) return;
      const t = state.myHand[idx];
      if (!state.board.length) return socket.emit('playTile', { roomCode: currentRoom, tileIndex: idx, side: 'left' });
      const f = state.board.slice(0, 1).pop(), l = state.board.slice(-1).pop();
      const fitL = t.a === f.a || t.b === f.a, fitR = t.a === l.b || t.b === l.b;
      if (!fitL && !fitR) return;
      if (fitL && fitR && f.a !== l.b) { selectedIdx = idx; document.getElementById('side-btns').style.display = 'flex'; }
      else socket.emit('playTile', { roomCode: currentRoom, tileIndex: idx, side: fitL ? 'left' : 'right' });
    }
    function confirmSide(side) { document.getElementById('side-btns').style.display = 'none'; socket.emit('playTile', { roomCode: currentRoom, tileIndex: selectedIdx, side }); }
    function passTurn() { socket.emit('passTurn', { roomCode: currentRoom }); }
  </script>
</body>
</html>
    

