/**
 * SyncRoom Durable Object
 *
 * Coordinates WebSocket connections for a workspace.
 * Routes encrypted changes between connected clients.
 * Server NEVER decrypts data - only relays opaque blobs.
 */

import type {
  Env,
  EncryptedChange,
  SyncMessage,
  ServerMessage,
  PresenceMember,
} from "./types";
import { verifyToken } from "./auth";

interface Session {
  accountId: string;
  siteId: string;
  webSocket: WebSocket;
  workspaceId: string | null;
  joinedAt: string;
  lastSeen: string;
}

/**
 * SyncRoom Durable Object - manages a workspace sync room
 */
export class SyncRoom implements DurableObject {
  private sessions: Map<WebSocket, Session> = new Map();
  private changes: EncryptedChange[] = [];
  private currentVersion = 0;
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    // Restore state from storage
    this.state.blockConcurrencyWhile(async () => {
      const storedVersion = await this.state.storage.get<number>("version");
      if (storedVersion !== undefined) {
        this.currentVersion = storedVersion;
      }

      const storedChanges =
        await this.state.storage.get<EncryptedChange[]>("changes");
      if (storedChanges) {
        this.changes = storedChanges;
      }
    });
  }

  /**
   * Handle HTTP requests (WebSocket upgrade)
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    // REST API for non-WebSocket clients
    if (url.pathname === "/changes" && request.method === "GET") {
      const sinceVersion = parseInt(url.searchParams.get("since") || "0");
      const changes = this.changes.filter((c) => c.version > sinceVersion);
      return Response.json({
        changes,
        version: this.currentVersion,
      });
    }

    if (url.pathname === "/changes" && request.method === "POST") {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      const token = authHeader.slice(7);
      const payload = await verifyToken(token, this.env.SYNC_SECRET || "");
      if (!payload) {
        return Response.json({ error: "Invalid token" }, { status: 401 });
      }

      const newChanges = (await request.json()) as EncryptedChange[];
      await this.applyChanges(newChanges);

      // Broadcast to WebSocket clients
      this.broadcast({
        type: "changes",
        changes: newChanges,
        version: this.currentVersion,
      });

      return Response.json({
        success: true,
        version: this.currentVersion,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  /**
   * Handle WebSocket upgrade
   */
  private async handleWebSocket(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket
    this.state.acceptWebSocket(server);

    // Create session (will be authenticated later)
    const session: Session = {
      accountId: "",
      siteId: "",
      webSocket: server,
      workspaceId: null,
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };
    this.sessions.set(server, session);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const session = this.sessions.get(ws);
    if (!session) return;

    session.lastSeen = new Date().toISOString();

    try {
      const msg: SyncMessage = JSON.parse(
        typeof message === "string" ? message : new TextDecoder().decode(message)
      );

      switch (msg.type) {
        case "auth":
          await this.handleAuth(ws, session, msg.token);
          break;
        case "join":
          await this.handleJoin(ws, session, msg.workspaceId);
          break;
        case "leave":
          await this.handleLeave(ws, session);
          break;
        case "push":
          await this.handlePush(ws, session, msg.changes);
          break;
        case "pull":
          await this.handlePull(ws, session, msg.sinceVersion);
          break;
        case "ack":
          // Client acknowledging receipt - could track this
          break;
      }
    } catch (error) {
      this.sendError(ws, "PARSE_ERROR", "Invalid message format");
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket) {
    const session = this.sessions.get(ws);
    if (session) {
      this.sessions.delete(ws);
      this.broadcastPresence();
    }
  }

  /**
   * Handle WebSocket error
   */
  async webSocketError(ws: WebSocket, error: unknown) {
    console.error("WebSocket error:", error);
    this.sessions.delete(ws);
  }

  /**
   * Handle auth message
   */
  private async handleAuth(ws: WebSocket, session: Session, token: string) {
    const payload = await verifyToken(token, this.env.SYNC_SECRET || "");
    if (!payload) {
      this.sendError(ws, "AUTH_FAILED", "Invalid or expired token");
      return;
    }

    session.accountId = payload.accountId;
    session.siteId = `site-${payload.accountId}-${Date.now()}`;

    this.send(ws, {
      type: "authenticated",
      accountId: payload.accountId,
    });
  }

  /**
   * Handle join message
   */
  private async handleJoin(
    ws: WebSocket,
    session: Session,
    workspaceId: string
  ) {
    if (!session.accountId) {
      this.sendError(ws, "NOT_AUTHENTICATED", "Must authenticate first");
      return;
    }

    // TODO: Check workspace membership via KV
    session.workspaceId = workspaceId;

    this.send(ws, {
      type: "joined",
      workspaceId,
      currentVersion: this.currentVersion,
    });

    this.broadcastPresence();
  }

  /**
   * Handle leave message
   */
  private async handleLeave(ws: WebSocket, session: Session) {
    session.workspaceId = null;
    this.broadcastPresence();
  }

  /**
   * Handle push message (client sending changes)
   */
  private async handlePush(
    ws: WebSocket,
    session: Session,
    changes: EncryptedChange[]
  ) {
    if (!session.accountId || !session.workspaceId) {
      this.sendError(ws, "NOT_JOINED", "Must join a workspace first");
      return;
    }

    await this.applyChanges(changes);

    // Acknowledge to sender
    this.send(ws, {
      type: "pushed",
      version: this.currentVersion,
    });

    // Broadcast to other clients
    this.broadcastExcept(ws, {
      type: "changes",
      changes,
      version: this.currentVersion,
    });
  }

  /**
   * Handle pull message (client requesting changes)
   */
  private async handlePull(
    ws: WebSocket,
    session: Session,
    sinceVersion: number
  ) {
    if (!session.accountId || !session.workspaceId) {
      this.sendError(ws, "NOT_JOINED", "Must join a workspace first");
      return;
    }

    const changes = this.changes.filter((c) => c.version > sinceVersion);

    this.send(ws, {
      type: "changes",
      changes,
      version: this.currentVersion,
    });
  }

  /**
   * Apply changes to storage
   */
  private async applyChanges(newChanges: EncryptedChange[]) {
    // Assign versions
    for (const change of newChanges) {
      this.currentVersion++;
      change.version = this.currentVersion;
      this.changes.push(change);
    }

    // Persist to durable storage
    await this.state.storage.put("version", this.currentVersion);
    await this.state.storage.put("changes", this.changes);

    // TODO: Compact old changes after threshold
  }

  /**
   * Send message to specific WebSocket
   */
  private send(ws: WebSocket, message: ServerMessage) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // WebSocket may be closed
    }
  }

  /**
   * Send error to specific WebSocket
   */
  private sendError(ws: WebSocket, code: string, message: string) {
    this.send(ws, { type: "error", code, message });
  }

  /**
   * Broadcast message to all connected clients
   */
  private broadcast(message: ServerMessage) {
    const json = JSON.stringify(message);
    for (const [ws, session] of this.sessions) {
      if (session.workspaceId) {
        try {
          ws.send(json);
        } catch {
          // WebSocket may be closed
        }
      }
    }
  }

  /**
   * Broadcast message to all clients except sender
   */
  private broadcastExcept(sender: WebSocket, message: ServerMessage) {
    const json = JSON.stringify(message);
    for (const [ws, session] of this.sessions) {
      if (ws !== sender && session.workspaceId) {
        try {
          ws.send(json);
        } catch {
          // WebSocket may be closed
        }
      }
    }
  }

  /**
   * Broadcast presence update
   */
  private broadcastPresence() {
    const members: PresenceMember[] = [];
    for (const [, session] of this.sessions) {
      if (session.accountId && session.workspaceId) {
        members.push({
          accountId: session.accountId,
          siteId: session.siteId,
          joinedAt: session.joinedAt,
          lastSeen: session.lastSeen,
        });
      }
    }

    this.broadcast({ type: "presence", members });
  }
}
