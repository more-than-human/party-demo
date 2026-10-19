import { Server, routePartykitRequest, type Connection } from "partyserver";
import type { ClientMessage, ServerMessage, Stroke, UserPresence } from "./types.ts";

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
        // Broadcast stroke to all peers excluding the sender (sender renders optimistically)
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
  async fetch(request: Request, env: Env): Promise<Response> {
    // Routes requests matching /parties/:server/:room to the respective PartyServer DO
    const response = await routePartykitRequest(request, env);
    if (response) return response;

    return new Response("Not found", { status: 404 });
  },
};
