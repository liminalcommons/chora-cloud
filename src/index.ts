/**
 * chora-cloud: Cloudflare Workers sync service
 *
 * Routes:
 * - POST /api/accounts - Create account
 * - POST /api/login - Login and get token
 * - POST /api/workspaces - Create workspace
 * - GET /api/workspaces - List workspaces
 * - WS /sync/:workspaceId - WebSocket sync
 * - POST /sync/:workspaceId/changes - REST sync (push)
 * - GET /sync/:workspaceId/changes - REST sync (pull)
 *
 * All entity data is E2E encrypted - server only sees opaque blobs.
 */

import type {
  Env,
  ApiResponse,
  CreateAccountRequest,
  LoginRequest,
  CreateWorkspaceRequest,
  WorkspaceMeta,
} from "./types";
import { createAccount, login, getAccount, verifyToken } from "./auth";

// Export Durable Object
export { SyncRoom } from "./sync";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check
      if (path === "/health") {
        return jsonResponse({ status: "ok", environment: env.ENVIRONMENT });
      }

      // Account creation
      if (path === "/api/accounts" && request.method === "POST") {
        const body = (await request.json()) as CreateAccountRequest;
        const account = await createAccount(env.ACCOUNTS, body);
        return jsonResponse({
          success: true,
          data: { id: account.id, email: account.email },
        });
      }

      // Login
      if (path === "/api/login" && request.method === "POST") {
        const body = (await request.json()) as LoginRequest;
        const result = await login(
          env.ACCOUNTS,
          env.SYNC_SECRET || "dev-secret",
          body
        );
        return jsonResponse({ success: true, data: result });
      }

      // Protected routes
      const authHeader = request.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
      const authPayload = token
        ? await verifyToken(token, env.SYNC_SECRET || "dev-secret")
        : null;

      // Create workspace
      if (path === "/api/workspaces" && request.method === "POST") {
        if (!authPayload) {
          return jsonResponse(
            { success: false, error: { code: "UNAUTHORIZED", message: "Invalid token" } },
            401
          );
        }

        const body = (await request.json()) as CreateWorkspaceRequest;
        const workspaceId = crypto.randomUUID();
        const now = new Date().toISOString();

        const workspace: WorkspaceMeta = {
          id: workspaceId,
          ownerId: authPayload.accountId,
          name: body.name, // Encrypted by client
          members: [authPayload.accountId],
          version: 0,
          createdAt: now,
        };

        // Store workspace
        await env.ACCOUNTS.put(`workspace:${workspaceId}`, JSON.stringify(workspace));

        // Add to user's workspaces
        const account = await getAccount(env.ACCOUNTS, authPayload.accountId);
        if (account) {
          account.workspaces.push(workspaceId);
          await env.ACCOUNTS.put(
            `account:${authPayload.accountId}`,
            JSON.stringify(account)
          );
        }

        return jsonResponse({ success: true, data: workspace });
      }

      // List workspaces
      if (path === "/api/workspaces" && request.method === "GET") {
        if (!authPayload) {
          return jsonResponse(
            { success: false, error: { code: "UNAUTHORIZED", message: "Invalid token" } },
            401
          );
        }

        const account = await getAccount(env.ACCOUNTS, authPayload.accountId);
        if (!account) {
          return jsonResponse(
            { success: false, error: { code: "NOT_FOUND", message: "Account not found" } },
            404
          );
        }

        const workspaces: WorkspaceMeta[] = [];
        for (const wsId of account.workspaces) {
          const wsJson = await env.ACCOUNTS.get(`workspace:${wsId}`);
          if (wsJson) {
            workspaces.push(JSON.parse(wsJson));
          }
        }

        return jsonResponse({ success: true, data: workspaces });
      }

      // Sync routes - delegate to Durable Object
      const syncMatch = path.match(/^\/sync\/([^/]+)/);
      if (syncMatch) {
        const workspaceId = syncMatch[1];

        // Get or create Durable Object for this workspace
        const id = env.SYNC_ROOM.idFromName(workspaceId);
        const stub = env.SYNC_ROOM.get(id);

        // Forward request to Durable Object
        const doUrl = new URL(request.url);
        doUrl.pathname = doUrl.pathname.replace(`/sync/${workspaceId}`, "");
        if (!doUrl.pathname) doUrl.pathname = "/";

        return stub.fetch(new Request(doUrl, request));
      }

      return jsonResponse(
        { success: false, error: { code: "NOT_FOUND", message: "Route not found" } },
        404
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return jsonResponse(
        { success: false, error: { code: "SERVER_ERROR", message } },
        500
      );
    }
  },
};

/**
 * Helper to create JSON response
 */
function jsonResponse(
  data: ApiResponse,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...headers,
    },
  });
}
