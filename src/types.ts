/**
 * chora-cloud type definitions
 *
 * All sync data is E2E encrypted - server only sees opaque blobs.
 */

/** Environment bindings for Cloudflare Workers */
export interface Env {
  SYNC_ROOM: DurableObjectNamespace;
  ACCOUNTS: KVNamespace;
  SYNC_SECRET?: string;
  ENVIRONMENT: string;
}

/** Account stored in KV */
export interface Account {
  id: string;
  email: string;
  passwordHash: string; // Argon2id hash
  workspaces: string[]; // Workspace IDs this account can access
  createdAt: string;
  lastLoginAt: string;
}

/** Workspace metadata (NOT the actual data - that's encrypted on client) */
export interface WorkspaceMeta {
  id: string;
  ownerId: string;
  name: string; // Encrypted by client, opaque to server
  members: string[]; // Account IDs
  version: number; // Current sync version
  createdAt: string;
}

/** Sync message protocol */
export type SyncMessage =
  | { type: "auth"; token: string }
  | { type: "join"; workspaceId: string }
  | { type: "leave"; workspaceId: string }
  | { type: "push"; changes: EncryptedChange[] }
  | { type: "pull"; sinceVersion: number }
  | { type: "ack"; version: number };

/** Server response messages */
export type ServerMessage =
  | { type: "error"; code: string; message: string }
  | { type: "authenticated"; accountId: string }
  | { type: "joined"; workspaceId: string; currentVersion: number }
  | { type: "changes"; changes: EncryptedChange[]; version: number }
  | { type: "pushed"; version: number }
  | { type: "presence"; members: PresenceMember[] };

/** Encrypted change (server cannot read content) */
export interface EncryptedChange {
  id: string; // Change ID
  entityId: string; // Entity being changed (may be encrypted)
  changeType: "create" | "update" | "delete";
  encryptedData: string; // Base64 encrypted payload
  nonce: string; // Encryption nonce
  siteId: string; // Originating site
  timestamp: string; // ISO timestamp
  version: number; // Logical clock version
}

/** Presence information for sync room */
export interface PresenceMember {
  accountId: string;
  siteId: string;
  joinedAt: string;
  lastSeen: string;
}

/** Auth token payload */
export interface AuthToken {
  accountId: string;
  exp: number; // Expiration timestamp
  iat: number; // Issued at timestamp
}

/** API response wrapper */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/** Account creation request */
export interface CreateAccountRequest {
  email: string;
  password: string;
}

/** Login request */
export interface LoginRequest {
  email: string;
  password: string;
}

/** Login response */
export interface LoginResponse {
  token: string;
  accountId: string;
  expiresAt: string;
}

/** Workspace creation request */
export interface CreateWorkspaceRequest {
  name: string; // Will be encrypted client-side
}
