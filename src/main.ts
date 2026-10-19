import "./style.css";
import type { ClientMessage, Point, ServerMessage, Stroke, UserPresence } from "./types.ts";

const ROOM_ID = "demo-room";
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const userListEl = document.getElementById("user-list")!;
const statusEl = document.getElementById("status")!;
const clearBtn = document.getElementById("clear-btn")!;

// Local State
let myUserId: string | null = null;
const users = new Map<string, UserPresence>();
let committedStrokes: Stroke[] = [];
let currentStroke: Point[] | null = null; // Private until pointer up

// High-DPI Canvas Resizing
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  render();
}
window.addEventListener("resize", resizeCanvas);

function drawPoints(points: Point[]) {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}

// Render Loop
function render() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 1. Draw committed strokes (public)
  for (const stroke of committedStrokes) {
    drawPoints(stroke.points);
  }

  // 2. Draw active local stroke (private)
  if (currentStroke && currentStroke.length > 0) {
    drawPoints(currentStroke);
  }
}

function updateUserUI() {
  userListEl.innerHTML = "";
  users.forEach((user) => {
    const el = document.createElement("span");
    const isSelf = user.id === myUserId;
    el.className = `user-tag ${isSelf ? "self" : ""}`;
    el.textContent = `${user.id.slice(0, 5)}${isSelf ? " (You)" : ""}`;
    userListEl.appendChild(el);
  });
}

// WebSocket Connection
const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = `${protocol}//${window.location.host}/parties/canvas-room/${ROOM_ID}`;
const ws = new WebSocket(wsUrl);

ws.onopen = () => {
  statusEl.textContent = "Connected";
  statusEl.style.color = "green";
};

ws.onclose = () => {
  statusEl.textContent = "Disconnected";
  statusEl.style.color = "red";
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data) as ServerMessage;

  switch (msg.type) {
    case "sync-init":
      myUserId = msg.yourId;
      committedStrokes = msg.state.strokes;
      Object.values(msg.state.users).forEach((u) => users.set(u.id, u));
      updateUserUI();
      render();
      break;

    case "user-joined":
      users.set(msg.user.id, msg.user);
      updateUserUI();
      break;

    case "user-left":
      users.delete(msg.userId);
      updateUserUI();
      break;

    case "stroke-added":
      committedStrokes.push(msg.stroke);
      render();
      break;

    case "canvas-cleared":
      committedStrokes = [];
      render();
      break;
  }
};

// Pointer Events (Drawing)
function getCanvasCoords(e: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  currentStroke = [getCanvasCoords(e)];
  render();
});

canvas.addEventListener("pointermove", (e) => {
  if (!currentStroke) return;
  currentStroke.push(getCanvasCoords(e));
  render();
});

function endStroke() {
  if (!currentStroke || !myUserId) return;
  if (currentStroke.length > 1) {
    const newStroke: Stroke = {
      id: crypto.randomUUID(),
      userId: myUserId,
      points: currentStroke,
    };

    // Optimistic local commit
    committedStrokes.push(newStroke);

    // Send to server
    const msg: ClientMessage = {
      type: "add-stroke",
      stroke: newStroke,
    };
    ws.send(JSON.stringify(msg));
  }
  currentStroke = null;
  render();
}

canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);

clearBtn.addEventListener("click", () => {
  committedStrokes = [];
  render();
  const msg: ClientMessage = { type: "clear-canvas" };
  ws.send(JSON.stringify(msg));
});

// Initial Setup
resizeCanvas();
