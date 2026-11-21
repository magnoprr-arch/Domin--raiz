  <script>
    const socket = io();
    let currentRoom = '', state = null, selectedIdx = null;
    let isVip = localStorage.getItem('domino_vip') === 'true';
    if (isVip) document.body.classList.add('vip-theme');
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('sala')) document.getElementById('join-code').value = urlParams.get('sala').toUpperCase();

    const PIPS_VERT = { 0: '', 1: '5', 2: '19', 3: '159', 4: '1379', 5: '13579', 6: '134679' };
    const PIPS_HORIZ = { 0: '', 1: '5', 2: '37', 3: '357', 4: '1379', 5: '13579', 6: '123789' };

    function drawHalf(n, isHoriz) {
      let c = '', a = (isHoriz ? PIPS_HORIZ[n] : PIPS_VERT[n]) || '';
      for (let i = 1; i <= 9; i++) c += a.includes(String(i)) ? '<span class="dot"></span>' : '<span></span>';
      return '<div class="half">' + c + '</div>';
    }

    socket.on('toast', m => { const e = document.getElementById('emoji-toast'); e.innerText = m; e.style.display = 'block'; setTimeout(() => e.style.display = 'none', 2500); });
    socket.on('errorMsg', m => alert(m));

    function openVipModal() { document.getElementById('vip-modal').style.display = 'flex'; }
    function activateVip() {
      socket.emit('validateVip', document.getElementById('vip-code-input').value, v => {
        if (v) { isVip = true; localStorage.setItem('domino_vip', 'true'); document.body.classList.add('vip-theme'); document.getElementById('vip-modal').style.display = 'none'; alert('VIP Ativado!'); }
        else alert('Chave invalida!');
      });
    }
    function createRoom() {
      socket.emit('createRoom', {
        playerName: document.getElementById('player-name').value || 'Anfitriao',
        insta: document.getElementById('player-insta').value,
        isVip, gameMode: document.getElementById('game-mode').value,
        passCost: document.getElementById('pass-cost').value,
        startChips: parseInt(document.getElementById('start-chips').value) || 500
      });
    }
    function joinRoom() {
      const code = document.getElementById('join-code').value;
      if (!code) return alert('Digite o codigo!');
      socket.emit('joinRoom', { roomCode: code, playerName: document.getElementById('player-name').value || 'Jogador', insta: document.getElementById('player-insta').value, isVip });
    }
    function startGame() { socket.emit('startGame', { roomCode: currentRoom }); }
    function shareWhatsApp() {
      window.open('https://wa.me' + encodeURIComponent('Entra na minha mesa de Domino (Sala ' + currentRoom + '): ' + window.location.origin + '/?sala=' + currentRoom), '_blank');
    }

    socket.on('gameState', s => {
      state = s; currentRoom = s.roomCode;
      document.getElementById('lobby-screen').style.display = 'none';
      if (!s.started && !s.roundEnded && s.board.length === 0) {
        document.getElementById('wait-screen').style.display = 'flex';
        document.getElementById('display-code').innerText = s.roomCode;
        document.getElementById('player-list').innerHTML = s.players.map((p, i) => '<div>Assento ' + (i + 1) + ': <strong>' + p.name + '</strong></div>').join('');
        document.getElementById('btn-start-game').style.display = s.mySeat === 0 ? 'block' : 'none';
        return;
      }
      document.getElementById('wait-screen').style.display = 'none';
      if (s.roundEnded) {
        document.getElementById('round-modal').style.display = 'flex';
        document.getElementById('round-desc').innerText = s.roundSummary;
        document.getElementById('round-players').innerHTML = s.players.map(p => '<div class="insta-row"><div><strong>' + p.name + '</strong><br><small>Vitorias: ' + p.wins + ' | Fichas: ' + p.chips + '</small></div>' + (p.insta ? '<a class="insta-link" href="https://instagram.com' + p.insta + '" target="_blank">@' + p.insta + '</a>' : '') + '</div>').join('');
        document.getElementById('btn-next-round').style.display = s.mySeat === 0 ? 'block' : 'none';
      } else document.getElementById('round-modal').style.display = 'none';
      renderGame();
    });
          
