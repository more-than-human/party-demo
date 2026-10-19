# Realtime Collaborative Canvas POC Specification

**Stack:** Cloudflare PartyServer, Cloudflare Workers Vite Plugin (`@cloudflare/vite-plugin`), TypeScript, Vanilla HTML5 Canvas.

---

## 1. Architecture & Data Model

### 1.1 Overview

The system consists of:

- **Server:** A Cloudflare Worker using `partyserver` (built on Cloudflare Durable Objects) managing room state, presence tracking, and stroke synchronization.
- **Client:** A single-page Vanilla TS application using HTML5 Canvas that communicates with the PartyServer room over WebSockets.
- **Room Strategy:** Fixed to `"demo-room"` for the POC, but routed dynamically via URL patterns (`/parties/canvas-room/:room`).

---

### 1.2 Shared Type Definitions (`src/shared/types.ts`)

```typescript
export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  userId: string;
  points: Point[];
}

export interface UserPresence {
  id: string;
  joinedAt: number;
}

// Room State stored in Durable Object memory
export interface RoomState {
  users: Record<string, UserPresence>;
  strokes: Stroke[];
}

// Client -> Server Messages
export type ClientMessage = { type: "add-stroke"; stroke: Stroke } | { type: "clear-canvas" };

// Server -> Client Messages
export type ServerMessage =
  | { type: "sync-init"; state: RoomState; yourId: string }
  | { type: "user-joined"; user: UserPresence }
  | { type: "user-left"; userId: string }
  | { type: "stroke-added"; stroke: Stroke }
  | { type: "canvas-cleared" };
```

---

## 2. Directory Structure

```text
my-canvas-app/
├── wrangler.jsonc
├── vite.config.ts
├── tsconfig.json
├── package.json
├── index.html
└── src/
    ├── shared/
    │   └── types.ts
    ├── server/
    │   └── index.ts          # Worker entry + PartyServer Server class
    └── client/
        └── main.ts           # Vanilla TS canvas + WebSocket client
```

---

## 3. Configuration & Setup

### 3.1 Project Scaffolding

Initialize the Cloudflare Vite Worker project:

```bash
npm create cloudflare@latest my-canvas-app -- --template cloudflare/workers-sdk/templates/vite-ts
cd my-canvas-app
npm install partyserver
```

### 3.2 `package.json`

Ensure `partyserver` and type definitions are present:

```json
{
  "name": "my-canvas-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "deploy": "vite build && wrangler deploy"
  },
  "dependencies": {
    "partyserver": "^0.0.40"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "^0.1.0",
    "@cloudflare/workers-types": "^4.20241022.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.8",
    "wrangler": "^3.80.0"
  }
}
```

### 3.3 `wrangler.jsonc`

Configure the Durable Object binding required by PartyServer:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-canvas-app",
  "main": "src/server/index.ts",
  "compatibility_date": "2024-10-22",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [
      {
        "name": "CanvasRoom",
        "class_name": "CanvasRoom",
      },
    ],
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["CanvasRoom"],
    },
  ],
  "assets": {
    "directory": "./dist/client",
  },
}
```

### 3.4 `vite.config.ts`

Configure the `@cloudflare/vite-plugin`:

```typescript
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [cloudflare()],
  build: {
    outDir: "dist/client",
  },
});
```

---

## 4. Server Implementation (`src/server/index.ts`)

```typescript
import { Server, routePartykitRequest, type Connection } from "partyserver";
import type { ClientMessage, ServerMessage, RoomState, Stroke, UserPresence } from "../shared/types";

export interface Env {
  CanvasRoom: DurableObjectNamespace<CanvasRoom>;
}

export class CanvasRoom extends Server<Env> {
  // In-memory room state for fast synchronization
  private strokes: Stroke[] = [];
  private users: Map<string, UserPresence> = new Map();

  async onConnect(connection: Connection) {
    const user: UserPresence = {
      id: connection.id,
      joinedAt: Date.now(),
    };
    this.users.set(connection.id, user);

    // 1. Send initial state to the connecting client
    const initPayload: ServerMessage = {
      type: "sync-init",
      yourId: connection.id,
      state: {
        users: Object.fromEntries(this.users.entries()),
        strokes: this.strokes,
      },
    };
    connection.send(JSON.stringify(initPayload));

    // 2. Broadcast join to all other room members
    const joinPayload: ServerMessage = {
      type: "user-joined",
      user,
    };
    this.broadcast(JSON.stringify(joinPayload), [connection.id]);
  }

  async onClose(connection: Connection) {
    this.users.delete(connection.id);
    const leavePayload: ServerMessage = {
      type: "user-left",
      userId: connection.id,
    };
    this.broadcast(JSON.stringify(leavePayload));
  }

  async onMessage(connection: Connection, message: string) {
    try {
      const parsed = JSON.parse(message) as ClientMessage;

      if (parsed.type === "add-stroke") {
        // Enforce server-side user ownership of the stroke
        const stroke: Stroke = {
          ...parsed.stroke,
          userId: connection.id,
        };
        this.strokes.push(stroke);

        const broadcastMsg: ServerMessage = {
          type: "stroke-added",
          stroke,
        };
        // Broadcast stroke to all peers including the sender (or exclude sender if client renders optimistically)
        this.broadcast(JSON.stringify(broadcastMsg), [connection.id]);
      } else if (parsed.type === "clear-canvas") {
        this.strokes = [];
        const clearMsg: ServerMessage = { type: "canvas-cleared" };
        this.broadcast(JSON.stringify(clearMsg));
      }
    } catch (err) {
      console.error("Failed to process message:", err);
    }
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Routes requests matching /parties/:server/:room to the respective PartyServer DO
    const response = await routePartykitRequest(request, env);
    if (response) return response;

    return new Response("Not found", { status: 404 });
  },
};
```

---

## 5. Client Implementation

### 5.1 HTML Template (`index.html`)

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PartyServer Collaborative Canvas</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex;
        flex-direction: column;
        height: 100vh;
        overflow: hidden;
        background: #f4f4f4;
      }
      #header {
        padding: 10px 16px;
        background: #ffffff;
        border-bottom: 1px solid #ddd;
        display: flex;
        align-items: center;
        gap: 16px;
      }
      #user-list {
        display: flex;
        gap: 8px;
        font-size: 13px;
      }
      .user-tag {
        background: #e2e8f0;
        padding: 2px 8px;
        border-radius: 12px;
      }
      .user-tag.self {
        background: #bfdbfe;
        font-weight: 600;
      }
      #canvas-container {
        flex: 1;
        position: relative;
      }
      canvas {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: #ffffff;
        cursor: crosshair;
        touch-action: none;
      }
    </style>
  </head>
  <body>
    <div id="header">
      <strong>Room: demo-room</strong>
      <div id="status">Connecting...</div>
      <div id="user-list"></div>
      <button id="clear-btn" style="margin-left:auto;">Clear Canvas</button>
    </div>
    <div id="canvas-container">
      <canvas id="canvas"></canvas>
    </div>
    <script type="module" src="/src/client/main.ts"></script>
  </body>
</html>
```

### 5.2 Client Logic (`src/client/main.ts`)

```typescript
import type { ClientMessage, ServerMessage, Stroke, Point, UserPresence } from "../shared/types";

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

function drawPoints(points: Point[]) {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
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
```

---

## 6. Verification & Run Checklist

1. **Start Development Server:**
   ```bash
   npm run dev
   ```
2. **Open Multiple Windows:**
   - Navigate to `http://localhost:5173` in two different browser tabs or separate windows.
3. **Verify Synchronized Features:**
   - **Presence:** Confirm both client IDs show up in the top header tag list.
   - **Private In-Progress Stroke:** Draw a continuous stroke on Tab A without releasing the mouse/pointer; Tab B should see nothing.
   - **Committed Stroke Broadcast:** Release the pointer on Tab A; Tab B should immediately see the completed black continuous stroke.
   - **Late Joiners:** Refresh Tab B or open Tab C; all strokes committed earlier should be rehydrated immediately via `sync-init`.
   - **Disconnection Handling:** Close Tab A; Tab B should observe Tab A’s ID disappear from the user list.
