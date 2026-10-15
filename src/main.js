import { Conversation } from "@elevenlabs/client";
import { marked } from "marked";
import DOMPurify from "dompurify";

const AGENT_ID = "agent_6001m4qv4hgceh9rm0v26d02m3k2";
const VERSION = "v4";

const $ = (id) => document.getElementById(id);
const startBtn = $("start");
const muteBtn = $("mute");
const statusEl = $("status");
const transcript = $("transcript");
const panel = $("panel");
const panelTitle = $("panel-title");
const panelBody = $("panel-body");
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
  transcript.append(row);
  transcript.scrollTop = transcript.scrollHeight;
}

function showContent({ title, markdown } = {}) {
  panelTitle.textContent = title || "";
  panelBody.innerHTML = DOMPurify.sanitize(marked.parse(markdown || ""));
  panel.hidden = false;
  panel.scrollTop = 0;
  return "A tartalom megjelent a képernyőn.";
}

$("panel-close").addEventListener("click", () => {
  panel.hidden = true;
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
      clientTools: { show_content: showContent },
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
    await openSession("webrtc");
  } catch (first) {
    console.warn("webrtc failed, retrying with websocket", first);
    setStatus("Kapcsolódás másik módon…");
    try {
      await openSession("websocket");
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
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
