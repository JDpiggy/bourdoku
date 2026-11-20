/* Bourdoku — Game of Kings (levels edition) v3 */
const ICON_URL = "bourd.png?v=4";
const STORAGE_KEY = "bourdoku_v3";
const PALETTE = [
  "#ffcfd2", "#a0c4ff", "#b9fbc0", "#fdffb6", "#cdb4db",
  "#ffdfba", "#b7e4c7", "#ff9aa2", "#c7ceea", "#ffd6a5",
];

/* ---------- visible error reporting ---------- */
let errorBanner = null;
function ensureErrorBanner() {
  if (errorBanner) return errorBanner;
  const b = document.createElement("div");
  b.id = "errorBanner";
  b.style.cssText =
    "position:fixed; top:10px; left:50%; transform:translateX(-50%); z-index:10000; " +
    "background:#fb5656; color:#fff; padding:10px 16px; border-radius:10px; " +
    "font-family:Nunito,sans-serif; font-size:0.9rem; box-shadow:0 6px 20px rgba(0,0,0,0.25); " +
    "max-width:92vw; text-align:center; display:none;";
  document.body.appendChild(b);
  errorBanner = b;
  return b;
}
function showError(msg) {
  const b = ensureErrorBanner();
  b.textContent = "Error: " + msg;
  b.style.display = "block";
  console.error("BOURDOKU ERROR:", msg);
  setTimeout(() => { b.style.display = "none"; }, 10000);
}
function log(msg) {
  console.log("[Bourdoku]", msg);
}

window.addEventListener("error", (ev) => {
  showError(ev.message + " (line " + ev.lineno + ")");
  return true;
});
window.addEventListener("unhandledrejection", (ev) => {
  showError("Unhandled: " + (ev.reason && ev.reason.message ? ev.reason.message : String(ev.reason)));
});

function $(id) {
  const el = document.getElementById(id);
  if (!el) showError("Missing element with id '" + id + "'");
  return el;
}
function on(el, type, fn) {
  if (!el) { showError("Cannot attach listener to null element (" + type + ")"); return; }
  el.addEventListener(type, (ev) => {
    try { fn(ev); } catch (e) { showError(e.message + " (" + e.stack.split("\n")[0] + ")"); }
  });
}

/* ---------- debug overlay ---------- */
let debugEl = null;
function ensureDebug() {
  if (debugEl) return debugEl;
  const d = document.createElement("div");
  d.id = "debugOverlay";
  d.style.cssText =
    "position:fixed; bottom:10px; right:10px; z-index:10000; " +
    "background:rgba(0,0,0,0.75); color:#0f0; padding:8px 12px; border-radius:8px; " +
    "font-family:Courier,monospace; font-size:0.7rem; max-width:320px; line-height:1.4; display:none;";
  document.body.appendChild(d);
  debugEl = d;
  return d;
}
function updateDebug() {
  if (!debugEl || debugEl.style.display === "none") return;
  const lines = [
    "level: " + level,
    "completed: " + completed,
    "view: " + currentView,
    "board.hidden: " + (boardArea ? boardArea.hidden : "null"),
    "levels.hidden: " + (levelsEl ? levelsEl.hidden : "null"),
    "completion.hidden: " + (completionEl ? completionEl.hidden : "null"),
    "kings: " + (cells ? cells.flat().filter(s => s === "king").length : "?"),
    "timer: " + (clockEl ? clockEl.textContent : "?"),
  ];
  debugEl.textContent = lines.join("\n");
}

window.addEventListener("keydown", (ev) => {
  if (ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === "d") {
    ev.preventDefault();
    const d = ensureDebug();
    d.style.display = (d.style.display === "none") ? "block" : "none";
    updateDebug();
  }
});

/* ---------- single source of truth for UI visibility ---------- */
let currentView = "board";
function setView(view) {
  try {
    currentView = view;
    // Use style.display directly — more reliable than the `hidden` attribute
    if (levelsEl)  levelsEl.style.display  = (view === "levels")  ? "" : "none";
    if (boardArea) boardArea.style.display = (view === "board")   ? "" : "none";
    if (completionEl) completionEl.style.display = (view === "completion") ? "" : "none";
    log("setView -> " + view + " | board.display=" + (boardArea ? boardArea.style.display : "null") + " | completion.display=" + (completionEl ? completionEl.style.display : "null"));
    updateDebug();
  } catch (e) { showError("setView(" + view + ") failed: " + e.message); }
}

/* ---------- seeded RNG (deterministic per level) ---------- */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- solver ---------- */
function touching(a, b) {
  return Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1;
}

function countSolutions(puzzle) {
  const n = puzzle.size;
  const regions = puzzle.regions;
  const colUsed = new Array(n).fill(false);
  const regUsed = new Array(n).fill(false);
  const placed = [];
  let count = 0;
  const cap = 2;
  function bt(r) {
    if (count >= cap) return;
    if (r === n) { count++; return; }
    for (let c = 0; c < n; c++) {
      if (colUsed[c]) continue;
      const reg = regions[r][c];
      if (regUsed[reg]) continue;
      const pos = [r, c];
      let ok = true;
      for (const p of placed) if (touching(p, pos)) { ok = false; break; }
      if (!ok) continue;
      colUsed[c] = true; regUsed[reg] = true; placed.push(pos);
      bt(r + 1);
      placed.pop(); regUsed[reg] = false; colUsed[c] = false;
    }
  }
  bt(0);
  return count;
}

/* ---------- level generator (deterministic per level number) ---------- */
function generateKings(size, rng) {
  const perm = [];
  const used = new Array(size).fill(false);
  function bt(r) {
    if (r === size) return true;
    const order = [];
    for (let i = 0; i < size; i++) order.push(i);
    order.sort(() => rng() - 0.5);
    for (const c of order) {
      if (used[c]) continue;
      if (r > 0 && Math.abs(perm[r - 1] - c) < 2) continue;
      used[c] = true; perm[r] = c;
      if (bt(r + 1)) return true;
      used[c] = false;
    }
    return false;
  }
  if (!bt(0)) return null;
  return perm.map((c, r) => [r, c]);
}

function partitionRegions(size, kings, rng) {
  const regions = Array.from({ length: size }, () => Array(size).fill(-1));
  kings.forEach(([r, c], i) => { regions[r][c] = i; });
  const cells = kings.map(([r, c]) => [[r, c]]);
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  let assigned = size;
  const total = size * size;
  for (let iter = 0; iter < total * 8 && assigned < total; iter++) {
    const order = [...Array(size).keys()].sort(() => rng() - 0.5);
    let placed = false;
    for (const rid of order) {
      const frontier = [];
      for (const [r, c] of cells[rid]) {
        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
          if (regions[nr][nc] === -1) frontier.push([nr, nc]);
        }
      }
      if (frontier.length === 0) continue;
      const [nr, nc] = frontier[Math.floor(rng() * frontier.length)];
      regions[nr][nc] = rid;
      cells[rid].push([nr, nc]);
      assigned++;
      placed = true;
      break;
    }
    if (!placed) break;
  }
  return assigned === total ? regions : null;
}

function fallbackPuzzle(level) {
  const regions = [
    [0, 0, 2, 1],
    [0, 0, 2, 1],
    [2, 2, 2, 2],
    [3, 3, 3, 3],
  ];
  return {
    puzzle: { id: `level-${level}-fallback`, size: 4, level, regions },
    kings: [[0, 1], [1, 3], [2, 0], [3, 2]],
  };
}

function generateLevel(level) {
  const size = Math.min(8, 4 + Math.floor((level - 1) / 2));
  const rng = mulberry32(level * 2654435761 + 12345);
  const cap = size >= 8 ? 80000 : 6000;
  for (let attempt = 0; attempt < cap; attempt++) {
    const kings = generateKings(size, rng);
    if (!kings) continue;
    const regions = partitionRegions(size, kings, rng);
    if (!regions) continue;
    const puzzle = { id: `level-${level}`, size, level, regions };
    if (countSolutions(puzzle) === 1) {
      log("Level " + level + " generated unique solution (size " + size + ")");
      return { puzzle, kings };
    }
  }
  log("Level " + level + ": random search exhausted, using fallback");
  return fallbackPuzzle(level);
}

/* ---------- game state ---------- */
let level = 1, maxLevel = 1, bestTimes = {};
let puzzle = null, cells = [], autoExcluded = [], history = [], histIdx = -1;
let startedAt = null, timerId = null, elapsed = 0, completed = false;

const levelNumEl = $("levelNum");
const clockEl = $("clock");
const statusEl = $("status");
const gridWrap = $("gridWrap");
const boardArea = $("boardArea");
const completionEl = $("completion");
const levelsEl = $("levels");

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      maxLevel = Math.max(1, p.maxLevel || 1);
      bestTimes = p.bestTimes || {};
      level = maxLevel;
    }
  } catch (e) {
    log("loadProgress failed: " + e.message);
  }
}
function saveProgress() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ maxLevel, bestTimes })); } catch (e) { log("saveProgress failed: " + e.message); }
}
function formatTime(s) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/* ---------- timer ---------- */
function startTimer() {
  stopTimer();
  startedAt = Date.now() - elapsed * 1000;
  timerId = setInterval(tickTimer, 1000);
  tickTimer();
}
function stopTimer() {
  if (timerId) { clearInterval(timerId); timerId = null; }
}
function tickTimer() {
  const now = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : elapsed;
  elapsed = now;
  if (clockEl) clockEl.textContent = formatTime(now);
  updateDebug();
}

/* ---------- cell helpers ---------- */
function emptyCells(n) { return Array.from({ length: n }, () => Array(n).fill("empty")); }
function copyCells(c) { return c.map(row => row.slice()); }
function pushHistory(next) {
  history = history.slice(0, histIdx + 1);
  history.push(next);
  histIdx++;
  if (history.length > 60) {
    history = history.slice(history.length - 60);
    histIdx = history.length - 1;
  }
}

/* ---------- auto-exclusion (row / column) ---------- */
/* Recomputed every render from current king positions.
   A cell is auto-excluded if it is empty and shares its row or column with a king.
   Manual Xs (cells === "excluded") are never overwritten by this. */
function computeAutoExcluded() {
  const n = puzzle.size;
  autoExcluded = Array.from({ length: n }, () => Array(n).fill(false));
  // find all kings
  const kings = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (cells[r][c] === "king") kings.push([r, c]);
  for (const [kr, kc] of kings) {
    // entire row
    for (let c = 0; c < n; c++) {
      if (c === kc) continue;
      if (cells[kr][c] === "empty") autoExcluded[kr][c] = true;
    }
    // entire column
    for (let r = 0; r < n; r++) {
      if (r === kr) continue;
      if (cells[r][kc] === "empty") autoExcluded[r][kc] = true;
    }
  }
}

/* ---------- validation ---------- */
function computeConflicts() {
  const n = puzzle.size;
  const conflicts = new Set();
  const kl = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (cells[r][c] === "king") kl.push([r, c]);
  const byRow = new Map(), byCol = new Map(), byReg = new Map();
  for (const [r, c] of kl) {
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r).push([r, c]);
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c).push([r, c]);
    const reg = puzzle.regions[r][c];
    if (!byReg.has(reg)) byReg.set(reg, []);
    byReg.get(reg).push([r, c]);
  }
  function addMulti(map) {
    for (const g of map.values()) if (g.length > 1) for (const k of g) conflicts.add(`${k[0]},${k[1]}`);
  }
  addMulti(byRow); addMulti(byCol); addMulti(byReg);
  for (let i = 0; i < kl.length; i++)
    for (let j = i + 1; j < kl.length; j++)
      if (touching(kl[i], kl[j])) {
        conflicts.add(`${kl[i][0]},${kl[i][1]}`);
        conflicts.add(`${kl[j][0]},${kl[j][1]}`);
      }
  return conflicts;
}
function checkVictory() {
  if (!puzzle) return false;
  const n = puzzle.size;
  let kingCount = 0;
  const rowCnt = new Array(n).fill(0), colCnt = new Array(n).fill(0), regCnt = new Array(n).fill(0);
  const kl = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (cells[r][c] === "king") {
        kingCount++;
        rowCnt[r]++;
        colCnt[c]++;
        regCnt[puzzle.regions[r][c]]++;
        kl.push([r, c]);
      }
  if (kingCount !== n) return false;
  for (let i = 0; i < n; i++) if (rowCnt[i] !== 1 || colCnt[i] !== 1 || regCnt[i] !== 1) return false;
  for (let i = 0; i < kl.length; i++)
    for (let j = i + 1; j < kl.length; j++)
      if (touching(kl[i], kl[j])) return false;
  return true;
}

/* ---------- rendering ---------- */
function regionColor(id) { return PALETTE[id % PALETTE.length]; }
function render() {
  try {
    if (!puzzle) { showError("render: puzzle is null"); return; }
    const n = puzzle.size;
    computeAutoExcluded();
    gridWrap.style.setProperty("--n", n);
    gridWrap.innerHTML = "";
    gridWrap.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    const conflicts = computeConflicts();
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-label", `Row ${r + 1}, column ${c + 1}`);
        const regionId = puzzle.regions[r][c];
        cell.style.backgroundColor = regionColor(regionId);
        const sameBelow = r + 1 < n && puzzle.regions[r + 1][c] === regionId;
        const sameRight = c + 1 < n && puzzle.regions[r][c + 1] === regionId;
        const bottomThick = r + 1 >= n || !sameBelow;
        const rightThick = c + 1 >= n || !sameRight;
        cell.style.borderBottom = `${bottomThick ? 4 : 1}px solid rgba(255,255,255,0.75)`;
        cell.style.borderRight = `${rightThick ? 4 : 1}px solid rgba(255,255,255,0.75)`;
        const label = document.createElement("span");
        label.className = "region-label";
        label.textContent = regionId;
        cell.appendChild(label);
        const state = cells[r][c];
        const isAutoExcluded = autoExcluded[r][c];
        const showX = state === "excluded" || isAutoExcluded;
        if (state === "excluded") cell.classList.add("state-excluded");
        if (isAutoExcluded) cell.classList.add("state-autoexcluded");
        const isConflict = state === "king" && conflicts.has(`${r},${c}`);
        if (isConflict) cell.classList.add("state-conflict");
        if (state === "king") {
          const piece = document.createElement("span");
          piece.className = "king-piece" + (isConflict ? " conflict" : "");
          const img = document.createElement("img");
          img.src = ICON_URL;
          img.alt = "king";
          img.onerror = function () {
            img.style.display = "none";
            const fb = document.createElement("span");
            fb.className = "fallback";
            fb.textContent = "\u2654";
            piece.appendChild(fb);
          };
          piece.appendChild(img);
          cell.appendChild(piece);
        } else if (showX) {
          const mark = document.createElement("span");
          mark.className = "ex-mark" + (isAutoExcluded ? " auto" : "");
          mark.textContent = "\u00D7";
          cell.appendChild(mark);
        }
        cell.addEventListener("click", () => { try { handleClick(r, c); } catch (e) { showError(e.message); } });
        cell.addEventListener("contextmenu", (ev) => { ev.preventDefault(); try { handleRightClick(r, c); } catch (e) { showError(e.message); } });
        cell.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); try { handleClick(r, c); } catch (e) { showError(e.message); } } });
        cell.tabIndex = 0;
        gridWrap.appendChild(cell);
      }
    }
    updateStatus(conflicts);
    updateDebug();
    // render() NEVER triggers completion — only applyMove does
  } catch (e) {
    showError("render failed: " + e.message);
  }
}
function updateStatus(conflicts) {
  try {
    if (!puzzle) return;
    const n = puzzle.size;
    let kings = 0;
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (cells[r][c] === "king") kings++;
    let msg = `${kings} / ${n} kings`;
    if (conflicts.size > 0) msg += ` — ${conflicts.size} conflicting`;
    statusEl.textContent = msg;
    statusEl.className = "status-text " + (conflicts.size > 0 ? "bad" : "ok");
  } catch (e) {
    showError("updateStatus failed: " + e.message);
  }
}

/* ---------- interaction ---------- */
function cycleState(s) { if (s === "empty") return "excluded"; if (s === "excluded") return "king"; return "empty"; }
function handleClick(r, c) { if (completed) return; applyMove(r, c, cycleState(cells[r][c])); }
function handleRightClick(r, c) {
  if (completed) return;
  const s = cells[r][c];
  if (s === "king") return;
  applyMove(r, c, s === "empty" ? "excluded" : "empty");
}
function applyMove(r, c, next) {
  try {
    const n = copyCells(cells);
    n[r][c] = next;
    cells = n;
    pushHistory(cells);
    render();
    // Victory check happens HERE, immediately after render
    if (checkVictory()) {
      completed = true;
      stopTimer();
      setView("completion");
      showCompletionContent();
      log("Victory! Level " + level + " completed in " + formatTime(elapsed));
    }
  } catch (e) {
    showError("applyMove failed: " + e.message);
  }
}
function undo() {
  try {
    if (completed || histIdx <= 0) return;
    histIdx--;
    cells = copyCells(history[histIdx]);
    history = history.slice(0, histIdx + 1);
    completed = false; // undoing un-completes
    render();
  } catch (e) { showError("undo failed: " + e.message); }
}
function redo() {
  try {
    if (completed || histIdx < 0 || histIdx >= history.length - 1) return;
    histIdx++;
    cells = copyCells(history[histIdx]);
    render();
  } catch (e) { showError("redo failed: " + e.message); }
}

/* ---------- level flow ---------- */
function startLevel(lvl) {
  try {
    level = lvl;
    if (levelNumEl) levelNumEl.textContent = String(level);
    const gen = generateLevel(level);
    if (!gen) throw new Error("generateLevel returned null for level " + level);
    puzzle = gen.puzzle;
    cells = emptyCells(puzzle.size);
    autoExcluded = Array.from({ length: puzzle.size }, () => Array(puzzle.size).fill(false));
    history = [copyCells(cells)];
    histIdx = 0;
    startedAt = null;
    elapsed = 0;
    completed = false;
    if (clockEl) clockEl.textContent = formatTime(0);
    setView("board");
    render();
    startTimer();
    log("Started level " + level + " (size " + puzzle.size + "x" + puzzle.size + ")");
  } catch (e) {
    showError("startLevel(" + lvl + ") failed: " + e.message);
  }
}
function resetPuzzle() {
  try {
    stopTimer();
    completed = false;
    elapsed = 0;
    cells = emptyCells(puzzle.size);
    autoExcluded = Array.from({ length: puzzle.size }, () => Array(puzzle.size).fill(false));
    history = [copyCells(cells)];
    histIdx = 0;
    if (clockEl) clockEl.textContent = formatTime(0);
    render();
  } catch (e) { showError("resetPuzzle failed: " + e.message); }
}

function buildLevelSelect() {
  try {
    const grid = $("levelGrid");
    if (!grid) return;
    grid.innerHTML = "";
    for (let l = 1; l <= maxLevel; l++) {
      const btn = document.createElement("button");
      btn.className = "lvl-btn unlocked" + (bestTimes[l] ? " done" : "");
      btn.textContent = String(l);
      if (bestTimes[l]) {
        const t = document.createElement("div");
        t.className = "lvl-time";
        t.textContent = "Best " + formatTime(bestTimes[l]);
        btn.appendChild(t);
      }
      on(btn, "click", () => { startLevel(l); });
      grid.appendChild(btn);
    }
    const hint = $("levelHint");
    if (hint) hint.textContent = `Levels 1–${maxLevel} unlocked. Same level N for every player.`;
  } catch (e) { showError("buildLevelSelect failed: " + e.message); }
}

function showCompletionContent() {
  try {
    const t = elapsed;
    const prev = bestTimes[level];
    if (prev === undefined || t < prev) { bestTimes[level] = t; saveProgress(); }
    if (level + 1 > maxLevel) { maxLevel = level + 1; saveProgress(); }
    const compLevel = $("compLevel");
    const compTime = $("compTime");
    const nextLevelNum = $("nextLevelNum");
    if (compLevel) compLevel.textContent = String(level);
    if (compTime) compTime.textContent = formatTime(t);
    if (nextLevelNum) nextLevelNum.textContent = String(level + 1);
    const canvas = $("confetti");
    if (canvas) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      startConfetti(canvas, 1400);
    }
    buildLevelSelect();
    log("Level " + level + " completed in " + formatTime(t));
  } catch (e) { showError("showCompletionContent failed: " + e.message); }
}

/* ---------- confetti ---------- */
function startConfetti(canvas, duration) {
  try {
    const ctx = canvas.getContext("2d");
    const colors = ["#ff006e", "#8338ec", "#3a86ff", "#06d6a0", "#ffbe0b", "#fb5607"];
    const count = 140;
    const particles = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: canvas.width / 2, y: canvas.height / 2 + 60,
        vx: (Math.random() - 0.5) * 16,
        vy: (Math.random() - 0.5) * 16 - 8,
        life: 1.0,
        decay: 0.012 + Math.random() * 0.02,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 6 + Math.random() * 9,
        rot: Math.random() * Math.PI,
        rotVel: (Math.random() - 0.5) * 0.5,
      });
    }
    let start = null;
    function frame(ts) {
      if (!start) start = ts;
      const elapsed = ts - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const p of particles) {
        if (p.life <= 0) continue;
        alive = true;
        p.x += p.vx; p.y += p.vy; p.vy += 0.3;
        p.rot += p.rotVel;
        p.life -= p.decay;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
      if (elapsed < duration && alive) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    requestAnimationFrame(frame);
  } catch (e) { log("confetti failed: " + e.message); }
}

/* ---------- init ---------- */
function init() {
  try {
    on($("btnReset"), "click", resetPuzzle);
    on($("btnLevels"), "click", () => { setView("levels"); buildLevelSelect(); });
    on($("btnCloseLevels"), "click", () => { setView("board"); });
    on($("btnCloseCompletion"), "click", () => { setView("levels"); buildLevelSelect(); });
    on($("btnPlayAgain"), "click", () => { startLevel(level); });
    on($("btnNextLevel"), "click", () => { startLevel(level + 1); });
    on($("btnToggleLabels"), "click", () => {
      const on = gridWrap.classList.toggle("labels-on");
      $("btnToggleLabels").textContent = on ? "ⓘ Hide region labels" : "ⓘ Show region labels";
    });
    on($("btnHowTo"), "click", () => {
      const b = $("howtoBody");
      if (b) {
        const was = b.classList.toggle("collapsed");
        log("how-to-play toggled to " + (!was));
      }
    });
    window.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        if (ev.shiftKey) redo(); else undo();
      }
    });

    loadProgress();
    buildLevelSelect();
    startLevel(level);
    setView("board");
    log("Bourdoku initialized. Level " + level);
  } catch (e) {
    showError("init failed: " + e.message);
  }
}

document.addEventListener("DOMContentLoaded", init);
