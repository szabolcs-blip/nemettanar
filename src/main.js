import { Conversation } from "@elevenlabs/client";
import { marked } from "marked";
import DOMPurify from "dompurify";

const AGENT_ID = "agent_6001m4qv4hgceh9rm0v26d02m3k2";
const VERSION = "v9";

const $ = (id) => document.getElementById(id);
const startBtn = $("start");
const muteBtn = $("mute");
const statusEl = $("status");
const transcript = $("transcript");
const jumpBtn = $("jump");
const canvas = $("orb");

let conversation = null;
let mode = "listening";
let muted = false;

marked.setOptions({ gfm: true, breaks: true });
document.getElementById("version").textContent = VERSION;

function setStatus(text) {
  statusEl.textContent = text;
}

function setRunning(running) {
  document.body.classList.toggle("running", running);
  startBtn.textContent = running ? "Beszélgetés vége" : "Beszélgetés indítása";
  muteBtn.hidden = !running;
}

function addLine(role, text) {
  if (!text) return;
  const row = document.createElement("div");
  row.className = "line " + role;
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = role === "agent" ? "Lena" : "Te";
  const msg = document.createElement("p");
  msg.textContent = text;
  row.append(who, msg);
  appendToTranscript(row);
}

// ---- Transcript follows the newest line unless the user scrolled up ----
function scrollToEnd() {
  transcript.scrollTop = transcript.scrollHeight;
}

function atEnd() {
  return transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 60;
}

// Decide before adding: if the reader was at the end, follow; if they had
// scrolled up to read, leave them there and offer the jump button.
function appendToTranscript(el, force = false) {
  const follow = force || atEnd();
  transcript.append(el);
  if (follow) scrollToEnd();
  else jumpBtn.hidden = false;
}

transcript.addEventListener("scroll", () => {
  if (atEnd()) jumpBtn.hidden = true;
});

// The list also changes height when the orb shrinks or the toolbar moves.
let wasAtEnd = true;
transcript.addEventListener("scroll", () => (wasAtEnd = atEnd()));
new ResizeObserver(() => {
  if (wasAtEnd) scrollToEnd();
}).observe(transcript);

jumpBtn.addEventListener("click", () => {
  jumpBtn.hidden = true;
  transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
});

// ---- Board: show_content is written on a board that stays put while the
// conversation scrolls next to it (below it on a phone, beside it when wide).
const board = $("board");
const boardTitle = $("board-title");
const boardBody = $("board-body");
const boardToggle = $("board-toggle");

function renderMarkdown(markdown) {
  const html = DOMPurify.sanitize(marked.parse(markdown || ""));
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  // Wide tables scroll sideways inside the board instead of stretching the page.
  tmp.querySelectorAll("table").forEach((t) => {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    t.replaceWith(wrap);
    wrap.append(t);
  });
  return tmp.childNodes;
}

function setBoardCollapsed(collapsed) {
  board.classList.toggle("collapsed", collapsed);
  boardToggle.textContent = collapsed ? "Kinyitás" : "Kicsinyítés";
  boardToggle.setAttribute("aria-expanded", String(!collapsed));
}

function putOnBoard({ title, markdown }) {
  boardTitle.textContent = title || "Tábla";
  boardBody.replaceChildren(...renderMarkdown(markdown));
  boardBody.scrollTop = 0;
  board.hidden = false;
  setBoardCollapsed(false);
  document.body.classList.add("has-board");
}

function showContent({ title, markdown } = {}) {
  const content = { title, markdown };
  putOnBoard(content);
  // A short marker in the conversation; tapping it puts that board back up.
  const mark = document.createElement("button");
  mark.className = "board-mark";
  mark.textContent = "📋 A táblára írta: " + (title || "táblázat");
  mark.addEventListener("click", () => putOnBoard(content));
  appendToTranscript(mark);
  return "Der Inhalt steht jetzt an der Tafel und bleibt dort sichtbar, während ihr sprecht.";
}

boardToggle.addEventListener("click", () => setBoardCollapsed(!board.classList.contains("collapsed")));
$("board-close").addEventListener("click", () => {
  board.hidden = true;
  document.body.classList.remove("has-board");
});

// ---- Local storage (may be unavailable, e.g. in private mode) ----
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not persisted; the app keeps working for this visit.
  }
}

// ---- Tempo ----
// ElevenLabs allows no TTS speed below 0.7, so the voice always runs at 0.7
// and the chosen tempo goes to Lena as a variable; she paces herself by it.
const TTS_SPEED = 0.7;
const TEMPOS = ["kozepes", "lassu", "nagyon_lassu"];
// Carry over the choice saved by the earlier speed-based picker.
const OLD_SPEED_TO_TEMPO = { "0.95": "kozepes", "0.8": "lassu", "0.7": "nagyon_lassu" };
let tempo = load("lena.tempo", OLD_SPEED_TO_TEMPO[load("lena.speed", "")] || "kozepes");
if (!TEMPOS.includes(tempo)) tempo = "kozepes";

const tempoButtons = document.querySelectorAll("#speed button");
function renderTempo() {
  tempoButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tempo === tempo)));
}
tempoButtons.forEach((b) =>
  b.addEventListener("click", () => {
    tempo = b.dataset.tempo;
    save("lena.tempo", tempo);
    renderTempo();
  })
);
renderTempo();

// ---- Notes: Lena saves them with save_notes, the last 3 are kept ----
const notesSheet = $("notes");
const notesList = $("notes-list");
const toast = $("toast");

function getNotes() {
  const notes = load("lena.notes", []);
  return Array.isArray(notes) ? notes : [];
}

function setNotes(notes) {
  save("lena.notes", notes);
  renderNotes();
}

function notesForLena() {
  const notes = getNotes();
  if (!notes.length) return "Noch keine Notizen.";
  return notes.map((n) => `${n.date}: ${n.notes}`).join("\n\n");
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let toastTimer = 0;
function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 2500);
}

function saveNotes({ notes } = {}) {
  const text = String(notes || "").trim();
  if (!text) return "Keine Notizen übergeben.";
  setNotes([...getNotes(), { date: today(), notes: text }].slice(-3));
  showToast("Jegyzet elmentve");
  return "Notizen gespeichert.";
}

function renderNotes() {
  const notes = getNotes();
  notesList.replaceChildren();
  $("notes-clear").hidden = !notes.length;
  if (!notes.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Még nincs jegyzet. Lena a beszélgetések végén ment ide összefoglalót.";
    notesList.append(empty);
    return;
  }
  // Newest first.
  notes
    .map((n, i) => ({ ...n, i }))
    .reverse()
    .forEach((n) => {
      const item = document.createElement("article");
      item.className = "note";
      const head = document.createElement("div");
      head.className = "note-head";
      const date = document.createElement("span");
      date.textContent = n.date;
      const del = document.createElement("button");
      del.className = "link";
      del.textContent = "Törlés";
      del.addEventListener("click", () => setNotes(getNotes().filter((_, j) => j !== n.i)));
      head.append(date, del);
      const body = document.createElement("p");
      body.textContent = n.notes;
      item.append(head, body);
      notesList.append(item);
    });
}

$("notes-open").addEventListener("click", () => {
  renderNotes();
  notesSheet.hidden = false;
});
$("notes-close").addEventListener("click", () => {
  notesSheet.hidden = true;
});
$("notes-clear").addEventListener("click", () => {
  if (confirm("Biztosan törlöd az összes jegyzetet?")) setNotes([]);
});

function describeDisconnect(details) {
  if (!details || details.reason === "user") return "A beszélgetés véget ért. [" + (details?.reason || "nincs ok") + "]";
  const ctx = details.context || {};
  const extra = [details.message, ctx.type, ctx.reason, details.closeReason, details.closeCode].filter(Boolean).join(" – ");
  if (details.reason === "agent") return "Lena bontotta a kapcsolatot." + (extra ? " (" + extra + ")" : "");
  return "Megszakadt a kapcsolat." + (extra ? " (" + extra + ")" : "");
}

// Resolves once the session is stable (Lena said something, or it stayed up
// for a few seconds); rejects if it fails or drops before that, so the caller
// can retry with the other connection type.
function openSession(connectionType) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let failed = false;
    const ok = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const fail = (err) => {
      if (!settled) {
        settled = true;
        failed = true;
        reject(err);
      }
    };
    Conversation.startSession({
      agentId: AGENT_ID,
      connectionType,
      clientTools: { show_content: showContent, save_notes: saveNotes },
      overrides: { tts: { speed: TTS_SPEED } },
      dynamicVariables: { previous_notes: notesForLena(), tempo },
      onConnect: () => {
        setRunning(true);
        setStatus("Lena figyel – beszélj nyugodtan.");
        setTimeout(ok, 8000);
      },
      onDisconnect: (details) => {
        console.warn("disconnect", connectionType, details);
        conversation = null;
        setRunning(false);
        if (!settled) {
          // The SDK ends a half-started session as if the user hung up and only
          // then rejects startSession with the real error; give that error a
          // moment to arrive so it is the one we report.
          setTimeout(() => fail(new Error(describeDisconnect(details))), 500);
          return;
        }
        ok();
        setStatus(describeDisconnect(details));
      },
      onError: (message, context) => {
        console.error("error", connectionType, message, context);
        setStatus("Hiba: " + message);
      },
      onModeChange: ({ mode: m }) => {
        mode = m;
        if (conversation) setStatus(m === "speaking" ? "Lena beszél…" : "Lena figyel…");
      },
      onMessage: ({ message, role, source }) => {
        ok();
        addLine(role || (source === "ai" ? "agent" : "user"), message);
      },
    })
      .then((c) => {
        if (failed) c.endSession().catch(() => {});
        else conversation = c;
      })
      .catch(fail);
  });
}

async function start() {
  startBtn.disabled = true;
  setStatus("Kapcsolódás…");
  try {
    // Ask for the microphone first so the permission prompt has a clear context,
    // then release it right away: on Android a still-open stream blocks the SDK.
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
  } catch (err) {
    console.error(err);
    setStatus("A mikrofon nincs engedélyezve. Engedélyezd a böngészőben, és próbáld újra.");
    startBtn.disabled = false;
    return;
  }

  try {
    // WebSocket first: on this phone WebRTC never connects, so trying it first
    // only cost a few seconds. WebRTC stays as the fallback.
    await openSession("websocket");
  } catch (first) {
    console.warn("websocket failed, retrying with webrtc", first);
    setStatus("Kapcsolódás másik módon…");
    try {
      await openSession("webrtc");
    } catch (second) {
      console.error(second);
      conversation = null;
      setRunning(false);
      const why = (e) => (e && (e.message || e.name || String(e))) || "ismeretlen";
      setStatus("Nem sikerült kapcsolódni. 1) " + why(first) + " 2) " + why(second));
    }
  } finally {
    startBtn.disabled = false;
  }
}

startBtn.addEventListener("click", async () => {
  if (conversation) {
    startBtn.disabled = true;
    await conversation.endSession();
    startBtn.disabled = false;
  } else {
    start();
  }
});

muteBtn.addEventListener("click", () => {
  if (!conversation) return;
  muted = !muted;
  conversation.setMicMuted(muted);
  muteBtn.textContent = muted ? "Mikrofon be" : "Némítás";
  muteBtn.classList.toggle("on", muted);
});

// ---- Orb: a soft glowing sphere that pulses with the voice volume ----
const ctx = canvas.getContext("2d");
let level = 0;
let t = 0;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = canvas.clientWidth;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resize).observe(canvas);
resize();

function draw() {
  const size = canvas.clientWidth;
  const c = size / 2;
  let target = 0;
  if (conversation) {
    try {
      target = mode === "speaking" ? conversation.getOutputVolume() : conversation.getInputVolume() * 0.6;
    } catch {
      target = 0;
    }
  }
  level += (Math.min(target * 1.6, 1) - level) * 0.18;
  t += conversation ? 0.02 : 0.008;

  const base = size * 0.27;
  const r = base * (1 + level * 0.28 + Math.sin(t * 2) * 0.015);
  ctx.clearRect(0, 0, size, size);

  // halo, kept inside the canvas so it never shows a hard edge
  const halo = ctx.createRadialGradient(c, c, r * 0.6, c, c, c);
  halo.addColorStop(0, `rgba(255, 196, 64, ${0.25 + level * 0.35})`);
  halo.addColorStop(1, "rgba(255, 196, 64, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();

  // sphere with slowly drifting highlight
  const hx = c + Math.cos(t) * r * 0.25;
  const hy = c - r * 0.3 + Math.sin(t * 1.3) * r * 0.1;
  const body = ctx.createRadialGradient(hx, hy, r * 0.05, c, c, r);
  body.addColorStop(0, "#fff6d8");
  body.addColorStop(0.35, "#ffc94a");
  body.addColorStop(0.75, "#e0452b");
  body.addColorStop(1, "#5a1420");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();

  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

if ("serviceWorker" in navigator) {
  // updateViaCache "none" makes the browser check sw.js itself on every start,
  // so a new release reaches the home-screen app without reinstalling.
  navigator.serviceWorker
    .register("sw.js", { updateViaCache: "none" })
    .then((reg) => reg.update())
    .catch(() => {});
}

// Local testing hook only; never present on the published site.
if (location.hostname === "localhost") window.__lena = { addLine, showContent, saveNotes };
