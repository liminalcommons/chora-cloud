/**
 * Type validation tests
 */

import { describe, it, expect } from "vitest";
import type {
  SyncMessage,
  ServerMessage,
  EncryptedChange,
  Account,
} from "../src/types";

describe("Type definitions", () => {
  it("should validate SyncMessage types", () => {
    const authMsg: SyncMessage = { type: "auth", token: "test-token" };
    const joinMsg: SyncMessage = { type: "join", workspaceId: "ws-123" };
    const pushMsg: SyncMessage = { type: "push", changes: [] };
    const pullMsg: SyncMessage = { type: "pull", sinceVersion: 0 };
    const ackMsg: SyncMessage = { type: "ack", version: 1 };

    expect(authMsg.type).toBe("auth");
    expect(joinMsg.type).toBe("join");
    expect(pushMsg.type).toBe("push");
    expect(pullMsg.type).toBe("pull");
    expect(ackMsg.type).toBe("ack");
  });

  it("should validate ServerMessage types", () => {
    const errorMsg: ServerMessage = {
      type: "error",
      code: "TEST",
      message: "Test error",
    };
    const authMsg: ServerMessage = {
      type: "authenticated",
      accountId: "acc-123",
    };
    const joinedMsg: ServerMessage = {
      type: "joined",
      workspaceId: "ws-123",
      currentVersion: 5,
    };

    expect(errorMsg.type).toBe("error");
    expect(authMsg.type).toBe("authenticated");
    expect(joinedMsg.type).toBe("joined");
  });

  it("should validate EncryptedChange structure", () => {
    const change: EncryptedChange = {
      id: "change-123",
      entityId: "entity-456",
      changeType: "create",
      encryptedData: btoa("encrypted-payload"),
      nonce: btoa("random-nonce"),
      siteId: "site-001",
      timestamp: new Date().toISOString(),
      version: 1,
    };

    expect(change.id).toBeDefined();
    expect(change.changeType).toBe("create");
    expect(["create", "update", "delete"]).toContain(change.changeType);
  });

  it("should validate Account structure", () => {
    const account: Account = {
      id: "acc-123",
      email: "test@example.com",
      passwordHash: "hashed-password",
      workspaces: ["ws-1", "ws-2"],
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };

    expect(account.id).toBeDefined();
    expect(account.email).toContain("@");
    expect(account.workspaces).toHaveLength(2);
  });
});
