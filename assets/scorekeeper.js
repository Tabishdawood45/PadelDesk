/* PadelDesk score engine — tennis-style padel scoring with 3 official deuce modes:
   'advantage' (classic), 'golden' (sudden death at 40-40),
   'star' (2026 FIP rule: up to two advantage cycles, then one deciding point). */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PDScore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(mode) {
    return {
      mode: mode || 'star',
      pA: 0, pB: 0, advA: false, advB: false, deuceReturns: 0,
      gA: 0, gB: 0, sA: 0, sB: 0,
      tb: false, tbA: 0, tbB: 0,
      sets: [], over: false, history: []
    };
  }

  function snap(st) {
    const { history, ...rest } = st;
    st.history.push(JSON.stringify(rest));
    if (st.history.length > 300) st.history.shift();
  }

  function undo(st) {
    const prev = st.history.pop();
    if (!prev) return st;
    const data = JSON.parse(prev);
    Object.assign(st, data);
    return st;
  }

  function winSet(st, team) {
    st.sets.push([st.gA, st.gB]);
    if (team === 'A') st.sA++; else st.sB++;
    st.gA = 0; st.gB = 0; st.tb = false; st.tbA = 0; st.tbB = 0;
    resetGamePoints(st);
    if (st.sA === 2 || st.sB === 2) st.over = true;
  }

  function resetGamePoints(st) {
    st.pA = 0; st.pB = 0; st.advA = false; st.advB = false; st.deuceReturns = 0;
  }

  function winGame(st, team) {
    if (team === 'A') st.gA++; else st.gB++;
    resetGamePoints(st);
    const me = team === 'A' ? st.gA : st.gB;
    const opp = team === 'A' ? st.gB : st.gA;
    if (me >= 6 && me - opp >= 2) winSet(st, team);
    else if (st.gA === 6 && st.gB === 6) st.tb = true;
  }

  function point(st, team) {
    if (st.over) return st;
    snap(st);
    const A = team === 'A';
    if (st.tb) {
      if (A) st.tbA++; else st.tbB++;
      const me = A ? st.tbA : st.tbB, opp = A ? st.tbB : st.tbA;
      if (me >= 7 && me - opp >= 2) {
        if (A) st.gA = 7; else st.gB = 7; // record 7-6
        winSet(st, team);
      }
      return st;
    }
    const myP = A ? st.pA : st.pB, opP = A ? st.pB : st.pA;
    if (myP < 3 && !(st.advA || st.advB)) {
      if (A) st.pA++; else st.pB++;
      return st;
    }
    if (myP === 3 && opP < 3) { winGame(st, team); return st; }
    // deuce territory (3-3)
    if (st.mode === 'golden') { winGame(st, team); return st; }
    const deciding = st.mode === 'star' && st.deuceReturns >= 2;
    if (deciding) { winGame(st, team); return st; }
    const myAdv = A ? st.advA : st.advB;
    const opAdv = A ? st.advB : st.advA;
    if (myAdv) { winGame(st, team); return st; }
    if (opAdv) {
      st.advA = false; st.advB = false;
      if (st.mode === 'star') st.deuceReturns++;
      return st;
    }
    if (A) st.advA = true; else st.advB = true;
    return st;
  }

  const LADDER = ['0', '15', '30', '40'];
  function display(st) {
    if (st.tb) return { a: String(st.tbA), b: String(st.tbB), label: 'Tiebreak — first to 7, win by 2' };
    let a = LADDER[st.pA], b = LADDER[st.pB], label = '';
    if (st.pA === 3 && st.pB === 3) {
      if (st.advA) { a = 'Ad'; b = '40'; label = 'Advantage left team'; }
      else if (st.advB) { a = '40'; b = 'Ad'; label = 'Advantage right team'; }
      else if (st.mode === 'golden') label = 'GOLDEN POINT — next point wins the game';
      else if (st.mode === 'star' && st.deuceReturns >= 2) label = 'STAR POINT — one deciding point';
      else if (st.mode === 'star') label = 'Deuce (' + (2 - st.deuceReturns) + ' advantage cycle' + (st.deuceReturns === 1 ? '' : 's') + ' left before the Star Point)';
      else label = 'Deuce';
    }
    if (st.over) label = 'Match over';
    return { a, b, label };
  }

  return { create, point, undo, display };
}));
