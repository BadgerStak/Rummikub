(function () {
  'use strict';

  var STORAGE_KEY = 'rummikubTrackerState_v1';
  var LAST_GAME_KEY = 'rummikubLastGameId_v1';
  var TILE_COLORS = ['#c42a2a', '#1e56a8', '#1e1e1e', '#d67a1e', '#6a3fa0', '#1e8a5a'];

  var app = document.getElementById('app');
  var modalBackdrop = document.getElementById('modal-backdrop');
  var modalContent = document.getElementById('modal-content');

  var firebaseReady = false;
  var db = null;
  var currentUnsub = null;
  var syncStatus = 'connecting'; // 'connecting' | 'synced' | 'error'

  /* ---------- state ---------- */

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function genGameId() {
    return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.players)) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  /** Writes the current in-memory state to whichever store owns it: Firestore for
   * a shared game, localStorage for a local-only one. */
  function persist() {
    if (state.gameId && firebaseReady && db) {
      db.collection('games').doc(state.gameId).set({
        players: state.players,
        rounds: state.rounds,
        started: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(function (err) {
        console.warn('Rummikub: sync write failed (will retry when back online)', err);
      });
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }

  var state = loadState() || {
    gameId: null,
    players: [],
    rounds: [],
    started: false
  };

  /* draft players used only on the setup screen before a game starts */
  var draftPlayers = state.started ? [] : (state.players.length ? state.players.slice() : [
    { id: uid(), name: '' },
    { id: uid(), name: '' }
  ]);

  /* ---------- helpers ---------- */

  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  function totalFor(playerId) {
    var total = 0;
    for (var i = 0; i < state.rounds.length; i++) {
      var s = state.rounds[i].scores[playerId];
      if (typeof s === 'number') total += s;
    }
    return total;
  }

  function sortedPlayersByTotal() {
    return state.players.slice().sort(function (a, b) {
      return totalFor(b.id) - totalFor(a.id);
    });
  }

  function colorFor(index) {
    return TILE_COLORS[index % TILE_COLORS.length];
  }

  /* ---------- URL helpers ---------- */

  function getUrlGameId() {
    var params = new URLSearchParams(window.location.search);
    return params.get('g');
  }

  function setUrlGameId(id) {
    var url = new URL(window.location.href);
    if (id) url.searchParams.set('g', id); else url.searchParams.delete('g');
    window.history.replaceState({}, '', url.toString());
  }

  /* ---------- Firebase / sync ---------- */

  function initFirebase() {
    try {
      var cfg = window.FIREBASE_CONFIG;
      if (!cfg || !cfg.apiKey || cfg.apiKey.indexOf('YOUR_') === 0 || typeof firebase === 'undefined') return;
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      db = firebase.firestore();
      try { db.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) { /* unsupported browser/tab */ }
      firebaseReady = true;
    } catch (e) {
      console.warn('Rummikub: Firebase init failed, continuing in local-only mode', e);
      firebaseReady = false;
    }
  }

  function setSyncStatus(s) {
    syncStatus = s;
    renderSyncBadge();
  }

  function applyRemoteState(gameId, data) {
    var roundsChanged = !state.started || state.gameId !== gameId || state.rounds.length !== (data.rounds || []).length;
    state = { gameId: gameId, players: data.players || [], rounds: data.rounds || [], started: true };
    localStorage.setItem(LAST_GAME_KEY, gameId);
    if (roundsChanged || !draftRound) draftRound = freshDraftRound();
    render();
  }

  function attachRemoteListener(gameId, isNewGame) {
    if (currentUnsub) { currentUnsub(); currentUnsub = null; }
    currentUnsub = db.collection('games').doc(gameId).onSnapshot(function (snap) {
      if (!snap.exists) {
        if (!isNewGame) renderJoinError('This game link is invalid, or the game was deleted.');
        return;
      }
      setSyncStatus('synced');
      applyRemoteState(gameId, snap.data());
    }, function (err) {
      console.warn('Rummikub: Firestore sync error', err);
      setSyncStatus('error');
      if (isNewGame) {
        alert('Could not start a shared game (check your Firebase setup) — continuing locally on this device only.');
        localStorage.removeItem(LAST_GAME_KEY);
        setUrlGameId(null);
        state = { gameId: null, players: state.players, rounds: state.rounds, started: true };
        persist();
        render();
      } else {
        renderJoinError('Could not load this shared game. Check your connection and try again.');
      }
    });
  }

  function beginGame(players) {
    if (!firebaseReady) {
      state = { gameId: null, players: players, rounds: [], started: true };
      draftRound = freshDraftRound();
      persist();
      render();
      return;
    }
    var gameId = genGameId();
    state = { gameId: gameId, players: players, rounds: [], started: true };
    draftRound = freshDraftRound();
    localStorage.setItem(LAST_GAME_KEY, gameId);
    setUrlGameId(gameId);
    setSyncStatus('connecting');
    render();
    db.collection('games').doc(gameId).set({
      players: players,
      rounds: [],
      started: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(function (err) {
      console.warn('Rummikub: could not create shared game', err);
    });
    attachRemoteListener(gameId, true);
  }

  function joinRemoteGame(gameId) {
    renderLoadingScreen();
    if (!firebaseReady) {
      renderJoinError('This is a shared game link, but sharing isn’t configured on this site yet.');
      return;
    }
    setSyncStatus('connecting');
    attachRemoteListener(gameId, false);
  }

  function resetToSetup() {
    if (currentUnsub) { currentUnsub(); currentUnsub = null; }
    localStorage.removeItem(LAST_GAME_KEY);
    setUrlGameId(null);
    state = { gameId: null, players: [], rounds: [], started: false };
    draftRound = null;
    draftPlayers = [{ id: uid(), name: '' }, { id: uid(), name: '' }];
    persist();
    render();
  }

  function shareCurrentGame() {
    var url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: 'Rummikub Score Tracker', text: 'Join our game and help keep score!', url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { alert('Link copied to clipboard!'); }).catch(function () { window.prompt('Copy this link:', url); });
    } else {
      window.prompt('Copy this link:', url);
    }
  }

  /* ---------- rendering: root ---------- */

  function render() {
    if (!state.started) {
      renderSetup();
    } else {
      renderGame();
    }
  }

  function renderLoadingScreen() {
    app.innerHTML = '<main class="screen"><div class="empty-hint" style="margin-top:60px;">Loading game…</div></main>';
  }

  function renderJoinError(msg) {
    app.innerHTML =
      '<main class="screen"><div class="empty-hint" style="margin-top:60px;">' + esc(msg) + '</div>' +
      '<button type="button" class="btn btn-primary" id="join-error-newgame" style="margin-top:16px;">Start a New Game</button></main>';
    document.getElementById('join-error-newgame').addEventListener('click', resetToSetup);
  }

  /* ---------- setup screen ---------- */

  function renderSetup() {
    var tpl = document.getElementById('tpl-setup');
    app.innerHTML = '';
    app.appendChild(tpl.content.cloneNode(true));

    var listEl = document.getElementById('player-list');
    listEl.innerHTML = draftPlayers.map(function (p, i) {
      return (
        '<div class="player-row" data-id="' + p.id + '">' +
          '<span class="player-swatch" style="background:' + colorFor(i) + '"></span>' +
          '<input type="text" placeholder="Player ' + (i + 1) + ' name" value="' + esc(p.name) + '" data-role="player-name" maxlength="20">' +
          (draftPlayers.length > 2 ? '<button type="button" class="remove-player-btn" data-role="remove-player" aria-label="Remove player">&times;</button>' : '') +
        '</div>'
      );
    }).join('');

    document.getElementById('add-player-btn').addEventListener('click', function () {
      draftPlayers.push({ id: uid(), name: '' });
      renderSetup();
    });

    listEl.querySelectorAll('[data-role="player-name"]').forEach(function (input) {
      input.addEventListener('input', function () {
        var row = input.closest('.player-row');
        var pid = row.getAttribute('data-id');
        var p = draftPlayers.find(function (x) { return x.id === pid; });
        if (p) p.name = input.value;
      });
    });

    listEl.querySelectorAll('[data-role="remove-player"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var row = btn.closest('.player-row');
        var pid = row.getAttribute('data-id');
        draftPlayers = draftPlayers.filter(function (x) { return x.id !== pid; });
        renderSetup();
      });
    });

    document.getElementById('start-game-btn').addEventListener('click', function () {
      var named = draftPlayers.map(function (p, i) {
        return { id: p.id, name: (p.name && p.name.trim()) || ('Player ' + (i + 1)), color: colorFor(i) };
      });
      if (named.length < 2) {
        alert('Add at least 2 players.');
        return;
      }
      beginGame(named);
    });

    var resumeBtn = document.getElementById('resume-game-btn');
    var savedHasGame = state.players.length > 0 && state.rounds.length > 0;
    if (savedHasGame && !state.started) {
      resumeBtn.hidden = false;
      resumeBtn.addEventListener('click', function () {
        state.started = true;
        persist();
        render();
      });
    }
  }

  /* ---------- game screen ---------- */

  var draftRound = null; // { winnerId, stalemate, tiles: {pid: number} }

  function freshDraftRound() {
    var tiles = {};
    state.players.forEach(function (p) { tiles[p.id] = 0; });
    return { winnerId: null, stalemate: false, tiles: tiles };
  }

  function renderGame() {
    if (!draftRound) draftRound = freshDraftRound();
    var tpl = document.getElementById('tpl-game');
    app.innerHTML = '';
    app.appendChild(tpl.content.cloneNode(true));

    document.getElementById('menu-btn').addEventListener('click', openMenuModal);
    document.getElementById('end-game-btn').addEventListener('click', openEndGameModal);

    renderSyncBadge();
    renderStandings();
    renderRoundEntry();
    renderHistory();
  }

  function renderSyncBadge() {
    var el = document.getElementById('sync-badge');
    if (!el) return;
    if (!state.gameId) { el.hidden = true; return; }
    el.hidden = false;
    if (syncStatus === 'synced') { el.textContent = '🟢 Shared game — tap ☰ to invite'; el.className = 'sync-badge synced'; }
    else if (syncStatus === 'connecting') { el.textContent = '🟡 Connecting…'; el.className = 'sync-badge connecting'; }
    else { el.textContent = '🔴 Sync issue — changes stay on this device'; el.className = 'sync-badge error'; }
  }

  function renderStandings() {
    var el = document.getElementById('standings');
    var sorted = sortedPlayersByTotal();
    var topTotal = sorted.length ? totalFor(sorted[0].id) : 0;
    el.innerHTML = sorted.map(function (p) {
      var total = totalFor(p.id);
      var isLeader = total === topTotal && state.rounds.length > 0;
      return (
        '<div class="standing-card' + (isLeader ? ' leader' : '') + '" style="border-left-color:' + p.color + '">' +
          '<div class="standing-name">' + (isLeader ? '<span class="crown">👑</span>' : '') + '<span>' + esc(p.name) + '</span></div>' +
          '<div class="standing-score' + (total < 0 ? ' negative' : '') + '">' + total + '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderRoundEntry() {
    var el = document.getElementById('round-entry');
    var roundNum = state.rounds.length + 1;

    var rows = state.players.map(function (p) {
      var isWinner = draftRound.winnerId === p.id;
      var inputDisabled = isWinner;
      return (
        '<div class="round-player-row" data-pid="' + p.id + '">' +
          '<div class="round-player-name"><span class="player-swatch" style="background:' + p.color + '"></span><span class="nm">' + esc(p.name) + '</span></div>' +
          '<button type="button" class="winner-toggle' + (isWinner ? ' active' : '') + '" data-role="toggle-winner" data-pid="' + p.id + '">' + (isWinner ? '🏆 Went Out' : 'Went Out') + '</button>' +
          '<input type="number" inputmode="numeric" class="tiles-input" data-role="tiles-input" data-pid="' + p.id + '" value="' + (draftRound.tiles[p.id] || 0) + '" min="0" ' + (inputDisabled ? 'disabled' : '') + '>' +
        '</div>'
      );
    }).join('');

    el.innerHTML =
      '<h2>Round ' + roundNum + '</h2>' +
      rows +
      '<label class="no-winner-row"><input type="checkbox" id="stalemate-check" ' + (draftRound.stalemate ? 'checked' : '') + '> No one went out (blocked round)</label>' +
      '<div class="round-actions">' +
        '<button type="button" class="btn btn-primary" id="submit-round-btn">Submit Round</button>' +
      '</div>';

    el.querySelectorAll('[data-role="toggle-winner"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pid = btn.getAttribute('data-pid');
        draftRound.winnerId = draftRound.winnerId === pid ? null : pid;
        if (draftRound.winnerId) draftRound.stalemate = false;
        renderRoundEntry();
      });
    });

    el.querySelectorAll('[data-role="tiles-input"]').forEach(function (input) {
      input.addEventListener('input', function () {
        var pid = input.getAttribute('data-pid');
        var v = parseInt(input.value, 10);
        draftRound.tiles[pid] = isNaN(v) ? 0 : Math.max(0, v);
      });
    });

    document.getElementById('stalemate-check').addEventListener('change', function (e) {
      draftRound.stalemate = e.target.checked;
      if (draftRound.stalemate) draftRound.winnerId = null;
      renderRoundEntry();
    });

    document.getElementById('submit-round-btn').addEventListener('click', submitRound);
  }

  function submitRound() {
    if (!draftRound.winnerId && !draftRound.stalemate) {
      alert('Pick who went out, or check "No one went out" for a blocked round.');
      return;
    }
    var scores = {};
    var sumOthers = 0;
    state.players.forEach(function (p) {
      if (p.id !== draftRound.winnerId) sumOthers += (draftRound.tiles[p.id] || 0);
    });
    state.players.forEach(function (p) {
      if (draftRound.winnerId && p.id === draftRound.winnerId) {
        scores[p.id] = sumOthers;
      } else {
        scores[p.id] = -(draftRound.tiles[p.id] || 0);
      }
    });
    state.rounds.push({
      winnerId: draftRound.winnerId,
      stalemate: draftRound.stalemate,
      tiles: Object.assign({}, draftRound.tiles),
      scores: scores
    });
    draftRound = freshDraftRound();
    persist();
    renderStandings();
    renderRoundEntry();
    renderHistory();
  }

  function renderHistory() {
    var table = document.getElementById('history-table');
    if (!state.rounds.length) {
      table.outerHTML = '<div class="empty-hint" id="history-empty">No rounds yet — submit your first round above.</div>';
      return;
    }
    var existingEmpty = document.getElementById('history-empty');
    if (existingEmpty) {
      existingEmpty.outerHTML = '<table class="history-table" id="history-table"></table>';
      table = document.getElementById('history-table');
    }

    var head = '<thead><tr><th>#</th>' + state.players.map(function (p) {
      return '<th>' + esc(p.name) + '</th>';
    }).join('') + '</tr></thead>';

    var runningTotals = {};
    state.players.forEach(function (p) { runningTotals[p.id] = 0; });

    var bodyRows = state.rounds.map(function (round, idx) {
      var cells = state.players.map(function (p) {
        var score = round.scores[p.id];
        if (typeof score !== 'number') return '<td>—</td>';
        runningTotals[p.id] += score;
        var isWinnerCell = round.winnerId === p.id;
        var sign = score > 0 ? '+' : '';
        return '<td class="editable' + (isWinnerCell ? ' winner-cell' : '') + '" data-round="' + idx + '">' + sign + score + '</td>';
      }).join('');
      return '<tr><td class="round-no" data-round="' + idx + '">' + (idx + 1) + '</td>' + cells + '</tr>';
    }).join('');

    var totalCells = state.players.map(function (p) {
      return '<td class="total-cell">' + runningTotals[p.id] + '</td>';
    }).join('');
    var totalRow = '<tr><td class="round-no">Σ</td>' + totalCells + '</tr>';

    table.innerHTML = head + '<tbody>' + bodyRows + totalRow + '</tbody>';

    table.querySelectorAll('td.editable, td.round-no[data-round]').forEach(function (cell) {
      cell.addEventListener('click', function () {
        var idx = parseInt(cell.getAttribute('data-round'), 10);
        openEditRoundModal(idx);
      });
    });
  }

  /* ---------- modals ---------- */

  function openModal(html) {
    modalContent.innerHTML = html;
    modalBackdrop.hidden = false;
  }
  function closeModal() {
    modalBackdrop.hidden = true;
    modalContent.innerHTML = '';
  }
  modalBackdrop.addEventListener('click', function (e) {
    if (e.target === modalBackdrop) closeModal();
  });

  function openMenuModal() {
    var shareRow = state.gameId ? '<button type="button" class="btn btn-secondary" id="m-share">🔗 Share Game Link</button>' : '';
    openModal(
      '<h2>Menu</h2>' +
      shareRow +
      '<button type="button" class="btn btn-secondary" id="m-add-player">+ Add Player (joins from next round)</button>' +
      '<button type="button" class="btn btn-secondary" id="m-rename">Rename a Player</button>' +
      '<button type="button" class="btn btn-danger" id="m-new-game" style="margin-top:16px;">Start New Game</button>' +
      '<button type="button" class="btn btn-ghost" id="m-close">Cancel</button>'
    );
    document.getElementById('m-close').addEventListener('click', closeModal);
    if (state.gameId) {
      document.getElementById('m-share').addEventListener('click', shareCurrentGame);
    }
    document.getElementById('m-add-player').addEventListener('click', function () {
      var name = prompt('New player name?');
      if (!name) return;
      var p = { id: uid(), name: name.trim() || ('Player ' + (state.players.length + 1)), color: colorFor(state.players.length) };
      state.players.push(p);
      draftRound.tiles[p.id] = 0;
      persist();
      closeModal();
      renderGame();
    });
    document.getElementById('m-rename').addEventListener('click', function () {
      openRenameModal();
    });
    document.getElementById('m-new-game').addEventListener('click', function () {
      if (confirm('Start a new game? This clears the current scoreboard.')) {
        closeModal();
        resetToSetup();
      }
    });
  }

  function openRenameModal() {
    var rows = state.players.map(function (p) {
      return (
        '<div class="modal-row">' +
          '<span class="player-swatch" style="background:' + p.color + '"></span>' +
          '<input type="text" data-pid="' + p.id + '" value="' + esc(p.name) + '" maxlength="20" style="flex:1;padding:10px;border-radius:8px;border:none;font-size:1rem;">' +
        '</div>'
      );
    }).join('');
    openModal(
      '<h2>Rename Players</h2>' + rows +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-primary" id="m-save-names">Save</button>' +
        '<button type="button" class="btn btn-ghost" id="m-cancel-names">Cancel</button>' +
      '</div>'
    );
    document.getElementById('m-cancel-names').addEventListener('click', closeModal);
    document.getElementById('m-save-names').addEventListener('click', function () {
      modalContent.querySelectorAll('input[data-pid]').forEach(function (input) {
        var pid = input.getAttribute('data-pid');
        var p = state.players.find(function (x) { return x.id === pid; });
        if (p && input.value.trim()) p.name = input.value.trim();
      });
      persist();
      closeModal();
      renderGame();
    });
  }

  function openEditRoundModal(idx) {
    var round = state.rounds[idx];
    if (!round) return;
    var rows = state.players.map(function (p) {
      var tileVal = round.tiles[p.id];
      if (typeof tileVal !== 'number') return '';
      var isWinner = round.winnerId === p.id;
      return (
        '<div class="modal-row">' +
          '<span class="player-swatch" style="background:' + p.color + '"></span>' +
          '<label>' + esc(p.name) + (isWinner ? ' 👑' : '') + '</label>' +
          '<button type="button" class="winner-toggle' + (isWinner ? ' active' : '') + '" data-role="e-winner" data-pid="' + p.id + '">Went Out</button>' +
          '<input type="number" min="0" data-pid="' + p.id + '" value="' + tileVal + '" ' + (isWinner ? 'disabled' : '') + '>' +
        '</div>'
      );
    }).join('');

    openModal(
      '<h2>Edit Round ' + (idx + 1) + '</h2>' +
      rows +
      '<label class="no-winner-row"><input type="checkbox" id="e-stalemate" ' + (round.stalemate ? 'checked' : '') + '> No one went out</label>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-primary" id="m-save-round">Save</button>' +
        '<button type="button" class="btn btn-danger" id="m-delete-round">Delete Round</button>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost" id="m-cancel-round">Cancel</button>'
    );

    var localWinnerId = round.winnerId;
    var localStalemate = round.stalemate;

    function refreshEditModal() {
      modalContent.querySelectorAll('[data-role="e-winner"]').forEach(function (btn) {
        var pid = btn.getAttribute('data-pid');
        var active = pid === localWinnerId;
        btn.classList.toggle('active', active);
        var input = modalContent.querySelector('input[data-pid="' + pid + '"]');
        if (input) input.disabled = active;
      });
      document.getElementById('e-stalemate').checked = localStalemate;
    }

    modalContent.querySelectorAll('[data-role="e-winner"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pid = btn.getAttribute('data-pid');
        localWinnerId = localWinnerId === pid ? null : pid;
        if (localWinnerId) localStalemate = false;
        refreshEditModal();
      });
    });
    document.getElementById('e-stalemate').addEventListener('change', function (e) {
      localStalemate = e.target.checked;
      if (localStalemate) localWinnerId = null;
      refreshEditModal();
    });

    document.getElementById('m-cancel-round').addEventListener('click', closeModal);

    document.getElementById('m-delete-round').addEventListener('click', function () {
      if (confirm('Delete round ' + (idx + 1) + '? This cannot be undone.')) {
        state.rounds.splice(idx, 1);
        persist();
        closeModal();
        renderStandings();
        renderHistory();
      }
    });

    document.getElementById('m-save-round').addEventListener('click', function () {
      if (!localWinnerId && !localStalemate) {
        alert('Pick who went out, or check "No one went out".');
        return;
      }
      var newTiles = {};
      modalContent.querySelectorAll('input[data-pid]').forEach(function (input) {
        var pid = input.getAttribute('data-pid');
        var v = parseInt(input.value, 10);
        newTiles[pid] = isNaN(v) ? 0 : Math.max(0, v);
      });
      var scores = {};
      var sumOthers = 0;
      Object.keys(newTiles).forEach(function (pid) {
        if (pid !== localWinnerId) sumOthers += newTiles[pid];
      });
      Object.keys(newTiles).forEach(function (pid) {
        scores[pid] = (localWinnerId && pid === localWinnerId) ? sumOthers : -newTiles[pid];
      });
      round.winnerId = localWinnerId;
      round.stalemate = localStalemate;
      round.tiles = newTiles;
      round.scores = scores;
      persist();
      closeModal();
      renderStandings();
      renderHistory();
    });
  }

  function openEndGameModal() {
    var sorted = sortedPlayersByTotal();
    var rows = sorted.map(function (p, i) {
      return (
        '<div class="modal-row">' +
          '<span class="player-swatch" style="background:' + p.color + '"></span>' +
          '<label>' + (i === 0 ? '👑 ' : (i + 1) + '. ') + esc(p.name) + '</label>' +
          '<strong>' + totalFor(p.id) + '</strong>' +
        '</div>'
      );
    }).join('');
    openModal(
      '<h2>Final Standings</h2>' + rows +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-primary" id="m-newgame-from-end">Start New Game</button>' +
        '<button type="button" class="btn btn-ghost" id="m-keep-playing">Keep Playing</button>' +
      '</div>'
    );
    document.getElementById('m-keep-playing').addEventListener('click', closeModal);
    document.getElementById('m-newgame-from-end').addEventListener('click', function () {
      closeModal();
      resetToSetup();
    });
  }

  /* ---------- init ---------- */

  function boot() {
    initFirebase();
    var urlGameId = getUrlGameId();
    if (!urlGameId && firebaseReady) {
      var lastGameId = localStorage.getItem(LAST_GAME_KEY);
      if (lastGameId) {
        urlGameId = lastGameId;
        setUrlGameId(lastGameId);
      }
    }
    if (urlGameId) {
      joinRemoteGame(urlGameId);
    } else {
      render();
    }
  }

  boot();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').catch(function () {});
    });
  }
})();
