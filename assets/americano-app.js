/* PadelDesk Americano app UI (uses PDEngine) */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const E = window.PDEngine;
  const APP = { st: null, settings: {}, ended: false, timer: { left: 0, total: 0, int: null } };

  /* ---------- helpers ---------- */
  function toast(msg, ok) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toastbox show' + (ok === false ? ' bad' : '');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.className = 'toastbox', 2600);
  }
  function copyText(txt, okMsg) {
    const done = () => toast(okMsg || 'Copied! Now paste it anywhere.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(() => fallbackCopy(txt, done));
    } else fallbackCopy(txt, done);
  }
  function fallbackCopy(txt, done) {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { prompt('Copy this text:', txt); }
    document.body.removeChild(ta);
  }
  const pName = id => { const p = APP.st.players.find(x => x.id === id); return p ? p.name : '?'; };
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function save() {
    try { localStorage.setItem('pd_current', JSON.stringify({ st: APP.st, settings: APP.settings, ended: APP.ended })); } catch (e) {}
  }

  /* ---------- setup ---------- */
  function parsePreview() {
    const parsed = E.parseNames($('namesInput').value);
    $('parseInfo').textContent = parsed.length
      ? parsed.length + ' players detected' + (parsed.length >= 4 ? ' ✓' : ' (need at least 4)')
      : 'Type or paste one name per line';
    renderRosterPrefs(parsed);
    updatePlan();
    return parsed;
  }

  function renderRosterPrefs(parsed) {
    const mixed = $('format').value === 'mixed';
    const levels = $('optLevels').checked;
    const box = $('rosterPrefs');
    if ((!mixed && !levels) || parsed.length === 0) { box.innerHTML = ''; box.classList.add('hide'); return; }
    box.classList.remove('hide');
    const old = {};
    box.querySelectorAll('tr[data-name]').forEach(tr => {
      old[tr.dataset.name] = { g: tr.querySelector('.gsel') ? tr.querySelector('.gsel').value : '', l: tr.querySelector('.lsel') ? tr.querySelector('.lsel').value : '' };
    });
    let html = '<div class="table-wrap"><table><thead><tr><th>Player</th>' + (mixed ? '<th>Gender</th>' : '') + (levels ? '<th>Level</th>' : '') + '</tr></thead><tbody>';
    parsed.forEach(p => {
      const prev = old[p.name] || {};
      html += '<tr data-name="' + esc(p.name) + '"><td>' + esc(p.name) + '</td>';
      if (mixed) {
        const g = prev.g || p.gender || '';
        html += '<td><select class="gsel"><option value="M"' + (g !== 'W' ? ' selected' : '') + '>Man</option><option value="W"' + (g === 'W' ? ' selected' : '') + '>Woman</option></select></td>';
      }
      if (levels) {
        const l = prev.l || '5';
        html += '<td><select class="lsel">' + [1,2,3,4,5,6,7,8,9,10].map(v => '<option' + (String(v) === l ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></td>';
      }
      html += '</tr>';
    });
    box.innerHTML = html + '</tbody></table></div><p class="hint">' + (mixed ? 'Tip: you can also tag names in the list, e.g. "Sara (f)" or "Ben (m)". ' : '') + (levels ? 'Level 1 = brand new, 10 = tournament player. Rough is fine.' : '') + '</p>';
  }

  function updatePlan() {
    const mins = parseInt($('planMinutes').value, 10);
    const parsed = E.parseNames($('namesInput').value);
    const courts = parseInt($('courts').value, 10) || 1;
    const out = $('planOut');
    if (!mins || parsed.length < 4) { out.innerHTML = ''; return; }
    const plans = E.planner(mins, parsed.length, courts);
    let html = '<div class="table-wrap"><table><thead><tr><th>Points per match</th><th>Rounds that fit</th><th>&asymp; minutes/round</th><th>Resting per round</th><th></th></tr></thead><tbody>';
    plans.forEach(p => {
      html += '<tr><td>' + p.pts + '</td><td><strong>' + p.rounds + '</strong></td><td>' + p.perRound + '</td><td>' + (p.resting || 'nobody') + '</td>' +
        '<td><button class="btn btn-soft btn-sm useplan" data-pts="' + p.pts + '" data-rounds="' + p.rounds + '" data-min="' + (p.perRound - 2) + '">Use</button></td></tr>';
    });
    out.innerHTML = html + '</tbody></table></div>';
    out.querySelectorAll('.useplan').forEach(b => b.addEventListener('click', () => {
      $('points').value = b.dataset.pts;
      $('targetRounds').value = b.dataset.rounds;
      $('timerMin').value = b.dataset.min;
      toast('Plan applied: ' + b.dataset.rounds + ' rounds of ' + b.dataset.pts + ' points');
    }));
  }

  function collectRoster() {
    const parsed = E.parseNames($('namesInput').value);
    const mixed = $('format').value === 'mixed';
    const levels = $('optLevels').checked;
    const prefs = {};
    document.querySelectorAll('#rosterPrefs tr[data-name]').forEach(tr => {
      prefs[tr.dataset.name] = {
        gender: tr.querySelector('.gsel') ? tr.querySelector('.gsel').value : null,
        level: tr.querySelector('.lsel') ? parseInt(tr.querySelector('.lsel').value, 10) : null
      };
    });
    return parsed.map(p => ({
      name: p.name,
      gender: mixed ? ((prefs[p.name] && prefs[p.name].gender) || p.gender || 'M') : p.gender,
      level: levels ? ((prefs[p.name] && prefs[p.name].level) || 5) : null
    }));
  }

  function start() {
    const roster = collectRoster();
    const format = $('format').value;
    if (roster.length < 4) return toast('You need at least 4 players.', false);
    if (format === 'team' && roster.length % 2 === 1) return toast('Team format needs an even number of players (fixed pairs).', false);
    if (format === 'mixed') {
      const m = roster.filter(r => r.gender === 'M').length, w = roster.length - m;
      if (Math.abs(m - w) > 1) toast('Heads up: ' + m + ' men / ' + w + ' women — some pairs may not be mixed.', false);
    }
    APP.settings = {
      useLevels: $('optLevels').checked,
      target: parseInt($('targetRounds').value, 10) || null,
      title: $('eventTitle').value.trim() || null
    };
    APP.st = E.createState({
      format,
      courts: parseInt($('courts').value, 10) || 1,
      points: parseInt($('points').value, 10),
      names: roster,
      restComp: $('restComp').value
    });
    APP.ended = false;
    try { E.generateRound(APP.st, { useLevels: APP.settings.useLevels }); }
    catch (err) { return toast(err.message, false); }
    $('setup').classList.add('hide');
    $('live').classList.remove('hide');
    renderAll(); save();
    window.scrollTo({ top: $('live').offsetTop - 70, behavior: 'smooth' });
  }

  /* ---------- live rendering ---------- */
  function renderAll() {
    renderRounds(); renderLeaderboard(); renderManage(); renderRestNext(); renderProgress();
  }

  function renderProgress() {
    const t = APP.settings.target;
    $('roundProgress').textContent = 'Round ' + APP.st.rounds.length + (t ? ' of ' + t + ' planned' : '');
    $('nextRoundBtn').textContent = APP.ended ? 'Tournament ended' : '▶ Generate round ' + (APP.st.rounds.length + 1);
    $('nextRoundBtn').disabled = APP.ended;
  }

  function renderRounds() {
    const box = $('roundsBox');
    box.innerHTML = '';
    APP.st.rounds.forEach((r, ri) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.marginTop = '14px';
      const current = ri === APP.st.rounds.length - 1 && !APP.ended;
      let html = '<div class="round-head"><h3>Round ' + (ri + 1) + '</h3>' + (current ? '<span class="pill">current</span>' : '') + '</div>';
      r.matches.forEach((m, mi) => {
        html += '<div class="match" data-r="' + ri + '" data-m="' + mi + '">' +
          '<span class="court-tag">Court ' + m.court + '</span>' +
          '<span class="team">' + esc(pName(m.a[0])) + ' &amp; ' + esc(pName(m.a[1])) + '</span>' +
          '<input class="score sA" type="number" inputmode="numeric" min="0" value="' + (m.sA == null ? '' : m.sA) + '" aria-label="Score team A">' +
          '<span class="vs">vs</span>' +
          '<input class="score sB" type="number" inputmode="numeric" min="0" value="' + (m.sB == null ? '' : m.sB) + '" aria-label="Score team B">' +
          '<span class="team" style="text-align:right">' + esc(pName(m.b[0])) + ' &amp; ' + esc(pName(m.b[1])) + '</span>' +
          '</div>';
      });
      if (r.resting.length) {
        html += '<div class="resting">\u{1FA91} Resting: <strong>' + r.resting.map(id => esc(pName(id))).join(', ') + '</strong>' +
          (APP.st.restComp === 'avg' ? ' <span class="muted small">(they get the round average in the standings)</span>' : '') + '</div>';
      }
      card.innerHTML = html;
      box.appendChild(card);
    });
    box.querySelectorAll('.match').forEach(el => {
      const ri = +el.dataset.r, mi = +el.dataset.m;
      const a = el.querySelector('.sA'), b = el.querySelector('.sB');
      function onInput(src, other, isA) {
        const total = APP.st.points;
        if (total > 0 && src.value !== '' ) {
          const v = parseInt(src.value, 10);
          if (!isNaN(v) && v >= 0 && v <= total) other.value = total - v;
        }
        E.setScore(APP.st, ri, mi, a.value, b.value);
        renderLeaderboard(); renderProgress(); save();
      }
      a.addEventListener('input', () => onInput(a, b, true));
      b.addEventListener('input', () => onInput(b, a, false));
    });
  }

  function renderLeaderboard() {
    const box = $('leaderboard');
    if (APP.st.format === 'team') {
      const rows = E.teamStandings(APP.st);
      let html = '<div class="table-wrap"><table><thead><tr><th>#</th><th>Team</th><th>Points</th><th>Won</th><th>+/-</th></tr></thead><tbody>';
      rows.forEach((r, i) => {
        html += '<tr' + (i === 0 ? ' class="hl"' : '') + '><td>' + (i + 1) + '</td><td>' + r.members.map(id => esc(pName(id))).join(' & ') + '</td><td><strong>' + r.pts + '</strong></td><td>' + r.won + '</td><td>' + (r.diff > 0 ? '+' : '') + r.diff + '</td></tr>';
      });
      box.innerHTML = html + '</tbody></table></div>';
      return;
    }
    const rows = E.standings(APP.st);
    let html = '<div class="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th>Points</th><th>Won</th><th>+/-</th><th>Rested</th></tr></thead><tbody>';
    rows.forEach((r, i) => {
      const comp = Math.round(r.comp);
      html += '<tr' + (i === 0 ? ' class="hl"' : '') + '><td>' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td><strong>' + r.total + '</strong>' +
        (comp > 0 ? ' <span class="muted small">(incl. +' + comp + ' rest)</span>' : '') + '</td><td>' + r.won + '</td><td>' + (r.diff > 0 ? '+' : '') + r.diff + '</td><td>' + r.rested + '</td></tr>';
    });
    box.innerHTML = html + '</tbody></table></div>';
  }

  function renderRestNext() {
    const el = $('restNext');
    if (APP.ended || APP.st.format === 'team') { el.classList.add('hide'); return; }
    const names = E.previewResters(APP.st);
    if (!names.length) { el.classList.add('hide'); return; }
    el.classList.remove('hide');
    el.innerHTML = '⏭️ Likely resting next round: <strong>' + names.map(esc).join(', ') + '</strong> <span class="muted small">(spread fairly — nobody sits twice in a row)</span>';
  }

  function renderManage() {
    const box = $('playerList');
    let html = '';
    APP.st.players.forEach(p => {
      html += '<div class="match" style="padding:8px 12px"><span class="team">' + esc(p.name) +
        (p.level ? ' <span class="pill">lvl ' + p.level + '</span>' : '') +
        (p.gender ? ' <span class="muted small">' + (p.gender === 'M' ? '♂' : '♀') + '</span>' : '') +
        (!p.active ? ' <span class="muted small">(paused)</span>' : '') + '</span>' +
        '<button class="btn btn-sm ' + (p.active ? 'btn-danger' : 'btn-soft') + '" data-id="' + p.id + '">' + (p.active ? 'Pause' : 'Bring back') + '</button></div>';
    });
    box.innerHTML = html;
    box.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', () => {
      const p = APP.st.players.find(x => x.id === +b.dataset.id);
      E.setActive(APP.st, p.id, !p.active);
      toast(p.active ? p.name + ' is back in from the next round.' : p.name + ' paused — rotation stays fair for the rest.');
      renderManage(); renderRestNext(); save();
    }));
  }

  function nextRound() {
    const last = APP.st.rounds[APP.st.rounds.length - 1];
    const unscored = last && last.matches.some(m => m.sA == null || m.sB == null);
    if (unscored && !confirm('Some scores in the current round are empty. Generate the next round anyway?')) return;
    try { E.generateRound(APP.st, { useLevels: APP.settings.useLevels }); }
    catch (err) { return toast(err.message, false); }
    renderAll(); save();
    if ($('timerAuto').checked) startTimer(true);
  }

  function endTournament() {
    APP.ended = true;
    $('finalPanel').classList.remove('hide');
    const rows = APP.st.format === 'team' ? E.teamStandings(APP.st) : E.standings(APP.st);
    const podium = $('podium');
    const medal = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
    podium.innerHTML = rows.slice(0, 3).map((r, i) => {
      const nm = r.name ? esc(r.name) : r.members.map(id => esc(pName(id))).join(' & ');
      return '<div class="card tc"><div style="font-size:2rem">' + medal[i] + '</div><strong>' + nm + '</strong><div class="muted">' + (r.total != null ? r.total : r.pts) + ' pts</div></div>';
    }).join('');
    renderProgress(); renderRestNext(); save();
    $('finalPanel').scrollIntoView({ behavior: 'smooth' });
  }

  /* ---------- timer ---------- */
  function fmt(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function startTimer(reset) {
    const mins = parseInt($('timerMin').value, 10) || 12;
    if (reset || APP.timer.left <= 0) APP.timer.left = mins * 60;
    clearInterval(APP.timer.int);
    APP.timer.int = setInterval(() => {
      APP.timer.left--;
      renderTimer();
      if (APP.timer.left <= 0) { clearInterval(APP.timer.int); beep(); }
    }, 1000);
    renderTimer();
  }
  function renderTimer() {
    const d = $('timerDisp');
    d.textContent = fmt(Math.max(0, APP.timer.left));
    d.parentElement.classList.toggle('warn', APP.timer.left <= 60);
  }
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.35, 0.7].forEach(t => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = 880; g.gain.setValueAtTime(0.4, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + t + 0.3);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.32);
      });
    } catch (e) {}
    toast('⏰ Round time is up!');
  }

  /* ---------- share / whatsapp / season ---------- */
  function waShare() {
    const txt = E.whatsappText(APP.st, { firstNamesOnly: $('privacyChk').checked, title: APP.settings.title });
    copyText(txt, 'Results copied — paste into WhatsApp \u{1F4AC}');
  }
  function linkShare() {
    const snap = E.snapshot(APP.st, $('privacyChk').checked);
    const url = location.origin + location.pathname + '#d=' + E.encodeSnapshot(snap);
    copyText(url, 'Share link copied — anyone can open it, read-only.');
  }
  function saveSeason() {
    if (APP.st.format === 'team') return toast('Season table works with individual formats.', false);
    const rows = E.standings(APP.st);
    let season;
    try { season = JSON.parse(localStorage.getItem('pd_season') || 'null'); } catch (e) { season = null; }
    if (!season) season = { sessions: [] };
    season.sessions.push({ date: new Date().toISOString().slice(0, 10), rows: rows.map(r => [r.name, r.total]) });
    localStorage.setItem('pd_season', JSON.stringify(season));
    toast('Session saved to your season table \u{1F4C8}');
    renderSeason();
  }
  function renderSeason() {
    let season;
    try { season = JSON.parse(localStorage.getItem('pd_season') || 'null'); } catch (e) { season = null; }
    const box = $('seasonBox');
    if (!season || !season.sessions.length) { box.innerHTML = '<p class="muted">No sessions saved yet. Finish a session and tap “Save to season”. Everything stays on this device.</p>'; return; }
    const agg = {};
    season.sessions.forEach(s => s.rows.forEach(([name, pts]) => {
      const k = name.toLowerCase();
      if (!agg[k]) agg[k] = { name, pts: 0, n: 0 };
      agg[k].pts += pts; agg[k].n++;
    }));
    const rows = Object.values(agg).sort((a, b) => b.pts - a.pts);
    let html = '<div class="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th>Total points</th><th>Sessions</th><th>Avg</th></tr></thead><tbody>';
    rows.forEach((r, i) => {
      html += '<tr' + (i === 0 ? ' class="hl"' : '') + '><td>' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td><strong>' + r.pts + '</strong></td><td>' + r.n + '</td><td>' + Math.round(r.pts / r.n) + '</td></tr>';
    });
    box.innerHTML = html + '</tbody></table></div><p class="small muted">' + season.sessions.length + ' session(s) saved on this device.</p>' +
      '<p><button class="btn btn-soft btn-sm" id="seasonCopy">\u{1F4AC} Copy season table for WhatsApp</button> <button class="btn btn-danger btn-sm" id="seasonClear">Clear season</button></p>';
    $('seasonCopy').addEventListener('click', () => {
      const lines = ['\u{1F3BE} Season standings – ' + new Date().toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }), ''];
      rows.forEach((r, i) => lines.push((['\u{1F947}','\u{1F948}','\u{1F949}'][i] || (i + 1) + '.') + ' ' + r.name + ' – ' + r.pts + ' pts (' + r.n + ' sessions)'));
      lines.push('', 'Tracked free on PadelDesk.org');
      copyText(lines.join('\n'), 'Season table copied \u{1F4CB}');
    });
    $('seasonClear').addEventListener('click', () => {
      if (confirm('Delete the whole season table from this device?')) { localStorage.removeItem('pd_season'); renderSeason(); }
    });
  }

  /* ---------- viewer mode ---------- */
  function viewerMode(data) {
    $('setup').classList.add('hide');
    $('viewer').classList.remove('hide');
    const nameOf = {}; data.n.forEach(([id, nm]) => nameOf[id] = nm);
    // rebuild a minimal state to reuse standings
    const st = { format: data.f, points: data.pts, restComp: 'none', players: data.n.map(([id, nm]) => ({ id, name: nm, active: true })), rounds: data.r.map(r => ({ matches: r.m.map(m => ({ court: m[0], a: m[1], b: m[2], sA: m[3], sB: m[4] })), resting: r.x })) };
    const rows = E.standings(st);
    let html = '<h2 class="mt0">Shared results</h2><div class="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th>Points</th><th>Won</th></tr></thead><tbody>';
    rows.forEach((r, i) => html += '<tr' + (i === 0 ? ' class="hl"' : '') + '><td>' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td><strong>' + r.pts + '</strong></td><td>' + r.won + '</td></tr>');
    html += '</tbody></table></div><h3>Rounds</h3>';
    st.rounds.forEach((r, ri) => {
      html += '<div class="card" style="margin-top:10px"><strong>Round ' + (ri + 1) + '</strong>';
      r.matches.forEach(m => {
        html += '<div class="match"><span class="court-tag">Court ' + m.court + '</span><span class="team">' + esc(nameOf[m.a[0]]) + ' & ' + esc(nameOf[m.a[1]]) + '</span><strong>' + (m.sA == null ? '–' : m.sA) + ' : ' + (m.sB == null ? '–' : m.sB) + '</strong><span class="team" style="text-align:right">' + esc(nameOf[m.b[0]]) + ' & ' + esc(nameOf[m.b[1]]) + '</span></div>';
      });
      if (r.resting.length) html += '<div class="resting">Resting: ' + r.resting.map(id => esc(nameOf[id])).join(', ') + '</div>';
      html += '</div>';
    });
    html += '<p style="margin-top:18px"><a class="btn btn-primary" href="/americano-generator/">Create your own tournament — free</a></p>';
    $('viewer').innerHTML = html;
  }

  /* ---------- init ---------- */
  function init() {
    if (!E) return;
    const hash = location.hash.match(/#d=([A-Za-z0-9\-_]+)/);
    if (hash) {
      try { viewerMode(E.decodeSnapshot(hash[1])); return; } catch (e) { /* fall through */ }
    }
    // query prefill (player-count landing pages)
    const q = new URLSearchParams(location.search);
    if (q.get('players')) {
      const n = Math.min(40, Math.max(4, parseInt(q.get('players'), 10) || 8));
      if (!$('namesInput').value.trim()) $('namesInput').value = Array.from({ length: n }, (_, i) => 'Player ' + (i + 1)).join('\n');
    }
    if (q.get('courts')) $('courts').value = q.get('courts');

    // resume?
    let savedState = null;
    try { savedState = JSON.parse(localStorage.getItem('pd_current') || 'null'); } catch (e) {}
    if (savedState && savedState.st && savedState.st.rounds.length) {
      $('resumeBanner').classList.remove('hide');
      $('resumeBtn').addEventListener('click', () => {
        APP.st = savedState.st; APP.settings = savedState.settings || {}; APP.ended = savedState.ended;
        $('setup').classList.add('hide'); $('live').classList.remove('hide'); $('resumeBanner').classList.add('hide');
        renderAll();
      });
      $('discardBtn').addEventListener('click', () => {
        localStorage.removeItem('pd_current'); $('resumeBanner').classList.add('hide');
      });
    }

    $('namesInput').addEventListener('input', parsePreview);
    $('format').addEventListener('change', () => { parsePreview(); $('teamHint').classList.toggle('hide', $('format').value !== 'team'); });
    $('optLevels').addEventListener('change', parsePreview);
    $('courts').addEventListener('input', updatePlan);
    $('planMinutes').addEventListener('input', updatePlan);
    $('startBtn').addEventListener('click', start);
    $('nextRoundBtn').addEventListener('click', nextRound);
    $('endBtn').addEventListener('click', endTournament);
    $('newBtn').addEventListener('click', () => {
      if (confirm('Start a new tournament? The current one will be cleared (season table is kept).')) {
        localStorage.removeItem('pd_current'); location.href = location.pathname;
      }
    });
    $('waBtn').addEventListener('click', waShare);
    $('shareBtn').addEventListener('click', linkShare);
    $('seasonSaveBtn').addEventListener('click', saveSeason);
    $('timerStart').addEventListener('click', () => startTimer(false));
    $('timerReset').addEventListener('click', () => { clearInterval(APP.timer.int); APP.timer.left = 0; startTimer(true); });
    $('timerPause').addEventListener('click', () => clearInterval(APP.timer.int));
    $('addPlayerBtn').addEventListener('click', () => {
      const nm = $('addName').value.trim();
      if (!nm) return;
      E.addPlayer(APP.st, { name: nm, level: APP.settings.useLevels ? 5 : null, gender: APP.st.format === 'mixed' ? ($('addGender') ? $('addGender').value : 'M') : null });
      $('addName').value = '';
      toast(nm + ' joins from the next round \u{1F44B}');
      renderManage(); renderRestNext(); save();
    });
    parsePreview(); renderSeason();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
