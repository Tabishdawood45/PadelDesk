/* PadelDesk Americano engine — pure logic, no DOM.
   Formats: americano | mexicano | mixed | team
   Guarantees it aims for:
   - rests spread evenly (max diff 1 between any two players present the whole time)
   - nobody rests twice in a row unless mathematically unavoidable
   - partner & opponent repeats minimised (hill-climbing)
   - optional skill balancing via player levels (1-10)
   - players can join / pause mid-session
*/
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PDEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

  /* ---------- state ---------- */
  function createState(cfg) {
    const st = {
      format: cfg.format || 'americano',       // americano|mexicano|mixed|team
      courts: Math.max(1, cfg.courts || 1),
      points: cfg.points || 21,                 // points per match (fixed total) or 0 = free score
      restComp: cfg.restComp || 'avg',          // 'avg' | 'none'
      players: [],
      teams: null,
      rounds: [],                               // {matches:[{court,a:[id,id],b:[id,id],sA,sB}], resting:[ids]}
      nextId: 0,
      rrQueue: null, rrPtr: 0
    };
    (cfg.names || []).forEach(n => addPlayer(st, n));
    if (st.format === 'team') buildTeams(st);
    return st;
  }

  function addPlayer(st, n) {
    const p = {
      id: st.nextId++,
      name: typeof n === 'string' ? n : n.name,
      gender: (n && n.gender) || null,          // 'M' | 'W' | null
      level: (n && n.level) || null,            // 1-10 | null
      active: true,
      joined: st.rounds.length                   // 0-based round index they joined before
    };
    st.players.push(p);
    if (st.format === 'team') buildTeams(st);
    return p;
  }

  function setActive(st, id, active) {
    const p = st.players.find(x => x.id === id);
    if (p) p.active = !!active;
  }

  function buildTeams(st) {
    // fixed pairs in entry order: players 0+1, 2+3, ...
    st.teams = [];
    const act = st.players;
    for (let i = 0; i + 1 < act.length; i += 2) {
      st.teams.push({ id: st.teams.length, members: [act[i].id, act[i + 1].id] });
    }
    st.rrQueue = null; st.rrPtr = 0;
  }

  /* ---------- derived stats ---------- */
  function getCounts(st) {
    const partner = {}, opp = {};
    st.rounds.forEach(r => r.matches.forEach(m => {
      partner[pairKey(m.a[0], m.a[1])] = (partner[pairKey(m.a[0], m.a[1])] || 0) + 1;
      partner[pairKey(m.b[0], m.b[1])] = (partner[pairKey(m.b[0], m.b[1])] || 0) + 1;
      m.a.forEach(x => m.b.forEach(y => { opp[pairKey(x, y)] = (opp[pairKey(x, y)] || 0) + 1; }));
    }));
    return { partner, opp };
  }

  function restCount(st, id) {
    return st.rounds.reduce((n, r) => n + (r.resting.includes(id) ? 1 : 0), 0);
  }
  function restedLastRound(st, id) {
    const last = st.rounds[st.rounds.length - 1];
    return !!(last && last.resting.includes(id));
  }

  /* ---------- resters ---------- */
  function chooseResters(st, active, need, forPreview) {
    if (need <= 0) return [];
    let genderBias = {};
    if (st.format === 'mixed') {
      const m = active.filter(p => p.gender === 'M').length;
      const w = active.filter(p => p.gender === 'W').length;
      // over-represented gender should rest first to keep pairs mixed
      active.forEach(p => {
        genderBias[p.id] = (p.gender === 'M' && m > w) || (p.gender === 'W' && w > m) ? -0.25 : 0;
      });
    }
    const scored = shuffle(active).map(p => ({
      p,
      k: [restCount(st, p.id), restedLastRound(st, p.id) ? 1 : 0, (genderBias[p.id] || 0)]
    }));
    scored.sort((x, y) => x.k[0] - y.k[0] || x.k[1] - y.k[1] || x.k[2] - y.k[2]);
    return scored.slice(0, need).map(s => s.p);
  }

  /* ---------- americano / mixed pairing via hill-climb ---------- */
  function strength(st, id) {
    const p = st.players.find(x => x.id === id);
    return (p && p.level) ? p.level : 5;
  }

  function arrangementCost(st, order, counts, useLevels, mixed) {
    // order: flat array of ids; court c = order[4c..4c+3]; pair A=(0,1) B=(2,3)
    let cost = 0;
    for (let c = 0; c * 4 + 3 < order.length; c++) {
      const a1 = order[c * 4], a2 = order[c * 4 + 1], b1 = order[c * 4 + 2], b2 = order[c * 4 + 3];
      const pc1 = counts.partner[pairKey(a1, a2)] || 0;
      const pc2 = counts.partner[pairKey(b1, b2)] || 0;
      cost += (pc1 * pc1 + pc2 * pc2) * 100;
      [[a1, b1], [a1, b2], [a2, b1], [a2, b2]].forEach(([x, y]) => {
        const oc = counts.opp[pairKey(x, y)] || 0;
        cost += oc * oc * 10;
      });
      if (useLevels) {
        const sA = strength(st, a1) + strength(st, a2);
        const sB = strength(st, b1) + strength(st, b2);
        cost += Math.abs(sA - sB) * 8;
      }
      if (mixed) {
        const g = id => { const p = st.players.find(x => x.id === id); return p ? p.gender : null; };
        if (g(a1) && g(a1) === g(a2)) cost += 1000;
        if (g(b1) && g(b1) === g(b2)) cost += 1000;
      }
    }
    return cost;
  }

  function bestArrangement(st, playing, useLevels) {
    const counts = getCounts(st);
    const mixed = st.format === 'mixed';
    let globalBest = null, globalCost = Infinity;
    const restarts = 4, steps = 350;
    for (let r = 0; r < restarts; r++) {
      let order;
      if (mixed) {
        // interleave genders so initial pairs are mixed where possible
        const men = shuffle(playing.filter(p => p.gender === 'M').map(p => p.id));
        const women = shuffle(playing.filter(p => p.gender === 'W').map(p => p.id));
        order = [];
        while (men.length || women.length) {
          if (men.length) order.push(men.pop());
          if (women.length) order.push(women.pop());
        }
      } else {
        order = shuffle(playing.map(p => p.id));
      }
      let cost = arrangementCost(st, order, counts, useLevels, mixed);
      for (let s = 0; s < steps; s++) {
        const i = Math.floor(Math.random() * order.length);
        let j = Math.floor(Math.random() * order.length);
        if (i === j) j = (j + 1) % order.length;
        [order[i], order[j]] = [order[j], order[i]];
        const c2 = arrangementCost(st, order, counts, useLevels, mixed);
        if (c2 <= cost) cost = c2;
        else [order[i], order[j]] = [order[j], order[i]];
      }
      if (cost < globalCost) { globalCost = cost; globalBest = order.slice(); }
    }
    return globalBest;
  }

  /* ---------- mexicano ordering ---------- */
  function mexicanoOrder(st, playing) {
    const table = standings(st);
    const scoredAny = st.rounds.some(r => r.matches.some(m => m.sA != null));
    let ranked;
    if (!scoredAny) {
      ranked = st.players.some(p => p.level)
        ? playing.slice().sort((a, b) => (b.level || 5) - (a.level || 5))
        : shuffle(playing);
    } else {
      const pos = {}; table.forEach((row, i) => pos[row.id] = i);
      ranked = playing.slice().sort((a, b) => (pos[a.id] ?? 999) - (pos[b.id] ?? 999));
    }
    // per court group of 4 by rank: 1&3 vs 2&4
    const order = [];
    for (let c = 0; c * 4 + 3 < ranked.length * 0 + ranked.length; c += 1) {
      const g = ranked.slice(c * 4, c * 4 + 4);
      if (g.length < 4) break;
      order.push(g[0].id, g[2].id, g[1].id, g[3].id);
    }
    return order;
  }

  /* ---------- team round robin (circle method) ---------- */
  function buildRRQueue(st) {
    const ids = st.teams.map(t => t.id);
    const n = ids.length;
    const list = ids.slice();
    if (n % 2 === 1) list.push(-1); // bye
    const m = list.length, queue = [];
    for (let r = 0; r < m - 1; r++) {
      for (let i = 0; i < m / 2; i++) {
        const t1 = list[i], t2 = list[m - 1 - i];
        if (t1 !== -1 && t2 !== -1) queue.push([t1, t2]);
      }
      list.splice(1, 0, list.pop()); // rotate all but first
    }
    st.rrQueue = queue; st.rrPtr = 0;
  }

  /* ---------- round generation ---------- */
  function generateRound(st, opts) {
    opts = opts || {};
    if (st.format === 'team') return generateTeamRound(st);
    const active = st.players.filter(p => p.active);
    if (active.length < 4) throw new Error('Need at least 4 active players.');
    const courtsUsed = Math.min(st.courts, Math.floor(active.length / 4));
    const need = active.length - courtsUsed * 4;
    const resters = chooseResters(st, active, need);
    const restIds = resters.map(p => p.id);
    const playing = active.filter(p => !restIds.includes(p.id));
    let order;
    if (st.format === 'mexicano') order = mexicanoOrder(st, playing);
    else order = bestArrangement(st, playing, opts.useLevels || st.players.some(p => p.level));
    const matches = [];
    for (let c = 0; c * 4 + 3 < order.length; c++) {
      matches.push({ court: c + 1, a: [order[c * 4], order[c * 4 + 1]], b: [order[c * 4 + 2], order[c * 4 + 3]], sA: null, sB: null });
    }
    const round = { matches, resting: restIds };
    st.rounds.push(round);
    return round;
  }

  function generateTeamRound(st) {
    if (!st.teams || st.teams.length < 2) throw new Error('Need at least 2 teams (4 players).');
    if (!st.rrQueue || st.rrPtr >= st.rrQueue.length) buildRRQueue(st);
    const used = new Set(), matches = [];
    let ptr = st.rrPtr;
    const taken = [];
    while (matches.length < st.courts && ptr < st.rrQueue.length) {
      const [t1, t2] = st.rrQueue[ptr];
      if (!used.has(t1) && !used.has(t2)) {
        used.add(t1); used.add(t2); taken.push(ptr);
        const A = st.teams[t1].members, B = st.teams[t2].members;
        matches.push({ court: matches.length + 1, a: A.slice(), b: B.slice(), tA: t1, tB: t2, sA: null, sB: null });
      }
      ptr++;
    }
    // remove taken entries from queue
    st.rrQueue = st.rrQueue.filter((_, i) => !taken.includes(i));
    const restingTeams = st.teams.filter(t => !used.has(t.id));
    const resting = [];
    restingTeams.forEach(t => t.members.forEach(id => resting.push(id)));
    const round = { matches, resting };
    st.rounds.push(round);
    return round;
  }

  function previewResters(st) {
    if (st.format === 'team') return [];
    const active = st.players.filter(p => p.active);
    const courtsUsed = Math.min(st.courts, Math.floor(active.length / 4));
    const need = active.length - courtsUsed * 4;
    return chooseResters(st, active, need, true).map(p => p.name);
  }

  /* ---------- scores & standings ---------- */
  function setScore(st, roundIdx, matchIdx, sA, sB) {
    const m = st.rounds[roundIdx].matches[matchIdx];
    m.sA = sA == null || sA === '' ? null : Number(sA);
    m.sB = sB == null || sB === '' ? null : Number(sB);
  }

  function standings(st) {
    const rows = {};
    st.players.forEach(p => rows[p.id] = { id: p.id, name: p.name, pts: 0, played: 0, won: 0, diff: 0, rested: 0, comp: 0 });
    st.rounds.forEach(r => {
      let roundTotal = 0, roundPlayers = 0, scored = true;
      r.matches.forEach(m => {
        if (m.sA == null || m.sB == null) { scored = false; return; }
        roundTotal += m.sA + m.sB; roundPlayers += 4;
        m.a.forEach(id => { if (rows[id]) { rows[id].pts += m.sA; rows[id].played++; rows[id].diff += m.sA - m.sB; if (m.sA > m.sB) rows[id].won++; } });
        m.b.forEach(id => { if (rows[id]) { rows[id].pts += m.sB; rows[id].played++; rows[id].diff += m.sB - m.sA; if (m.sB > m.sA) rows[id].won++; } });
      });
      r.resting.forEach(id => { if (rows[id]) rows[id].rested++; });
      if (scored && st.restComp === 'avg' && roundPlayers > 0) {
        const avg = roundTotal / roundPlayers;
        r.resting.forEach(id => { if (rows[id]) rows[id].comp += avg; });
      }
    });
    const list = Object.values(rows).map(r => ({ ...r, total: r.pts + Math.round(r.comp) }));
    list.sort((a, b) => b.total - a.total || b.won - a.won || b.diff - a.diff || a.name.localeCompare(b.name));
    return list;
  }

  function teamStandings(st) {
    if (!st.teams) return [];
    const rows = {};
    st.teams.forEach(t => rows[t.id] = { id: t.id, members: t.members, pts: 0, played: 0, won: 0, diff: 0 });
    st.rounds.forEach(r => r.matches.forEach(m => {
      if (m.sA == null || m.sB == null || m.tA == null) return;
      rows[m.tA].pts += m.sA; rows[m.tA].played++; rows[m.tA].diff += m.sA - m.sB; if (m.sA > m.sB) rows[m.tA].won++;
      rows[m.tB].pts += m.sB; rows[m.tB].played++; rows[m.tB].diff += m.sB - m.sA; if (m.sB > m.sA) rows[m.tB].won++;
    }));
    const list = Object.values(rows);
    list.sort((a, b) => b.pts - a.pts || b.won - a.won || b.diff - a.diff);
    return list;
  }

  /* ---------- session planner ---------- */
  const ROUND_MINUTES = { 16: 12, 21: 15, 24: 17, 32: 22 };
  function planner(totalMin, players, courts) {
    const out = [];
    [16, 21, 24, 32].forEach(pts => {
      const per = ROUND_MINUTES[pts] + 2; // +2 min changeover
      const rounds = Math.max(1, Math.floor(totalMin / per));
      const simul = Math.min(courts, Math.floor(players / 4));
      const resting = players - simul * 4;
      out.push({ pts, rounds, perRound: per, resting, restEvery: resting > 0 ? Math.round(players / resting) : 0 });
    });
    return out;
  }

  /* ---------- name parsing (WhatsApp paste) ---------- */
  function parseNames(text) {
    const seen = new Set(), out = [];
    text.split(/\n+/).forEach(line => {
      let s = line
        .replace(/^[\s‍️]*[\d]+[\.\)\:\-]?\s*/, '')      // leading "1." "2)" etc
        .replace(/^[\-\–\—\*\•\.\>]+\s*/, '')                      // bullets
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, '') // emojis
        .replace(/\s{2,}/g, ' ')
        .trim();
    // gender tag: "(f)" / "(m)" / "(w)" at end
      let gender = null;
      const gm = s.match(/\((m|f|w)\)\s*$/i);
      if (gm) {
        gender = gm[1].toUpperCase() === 'M' ? 'M' : 'W';
        s = s.replace(/\((m|f|w)\)\s*$/i, '').trim();
      }
      if (!s) return;
      const k = s.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ name: s, gender });
    });
    return out;
  }

  /* ---------- privacy + WhatsApp export ---------- */
  function privacyNames(names) {
    const firsts = {}, out = {};
    names.forEach(n => {
      const f = n.split(/\s+/)[0];
      firsts[f] = (firsts[f] || 0) + 1;
    });
    names.forEach(n => {
      const parts = n.split(/\s+/);
      const f = parts[0];
      out[n] = firsts[f] > 1 && parts[1] ? f + ' ' + parts[1][0] + '.' : f;
    });
    return out;
  }

  const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
  function whatsappText(st, opts) {
    opts = opts || {};
    const table = st.format === 'team' ? null : standings(st);
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const title = opts.title || ('Padel ' + (st.format === 'mexicano' ? 'Mexicano' : 'Americano'));
    let nameMap = null;
    if (opts.firstNamesOnly && table) nameMap = privacyNames(table.map(r => r.name));
    const lines = ['\u{1F3BE} ' + title + ' – ' + date, '', '\u{1F3C6} Standings:'];
    if (table) {
      table.forEach((r, i) => {
        const nm = nameMap ? nameMap[r.name] : r.name;
        lines.push((MEDALS[i] || (i + 1) + '.') + ' ' + nm + ' – ' + r.total + ' pts');
      });
    } else {
      teamStandings(st).forEach((r, i) => {
        const names = r.members.map(id => { const p = st.players.find(x => x.id === id); return p ? p.name : '?'; }).join(' & ');
        lines.push((MEDALS[i] || (i + 1) + '.') + ' ' + names + ' – ' + r.pts + ' pts');
      });
    }
    lines.push('', 'Rounds played: ' + st.rounds.length, 'Made free with PadelDesk.org \u{1F3BE}');
    return lines.join('\n');
  }

  /* ---------- snapshot share link ---------- */
  function snapshot(st, firstNamesOnly) {
    let nameOf = {};
    st.players.forEach(p => nameOf[p.id] = p.name);
    if (firstNamesOnly) {
      const map = privacyNames(st.players.map(p => p.name));
      st.players.forEach(p => nameOf[p.id] = map[p.name]);
    }
    return {
      v: 1, f: st.format, pts: st.points,
      n: st.players.map(p => [p.id, nameOf[p.id]]),
      r: st.rounds.map(r => ({
        m: r.matches.map(m => [m.court, m.a, m.b, m.sA, m.sB]),
        x: r.resting
      }))
    };
  }
  function encodeSnapshot(snap) {
    const json = JSON.stringify(snap);
    const b64 = (typeof btoa !== 'undefined')
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, 'utf8').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeSnapshot(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const json = (typeof atob !== 'undefined')
      ? decodeURIComponent(escape(atob(s)))
      : Buffer.from(s, 'base64').toString('utf8');
    return JSON.parse(json);
  }

  return {
    createState, addPlayer, setActive, generateRound, previewResters,
    setScore, standings, teamStandings, planner, parseNames,
    whatsappText, privacyNames, snapshot, encodeSnapshot, decodeSnapshot,
    getCounts, restCount, ROUND_MINUTES
  };
}));
