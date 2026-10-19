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
