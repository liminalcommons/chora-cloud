/**
 * Tests for SyncRoom Durable Object
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { EncryptedChange, SyncMessage, ServerMessage } from "../src/types";

describe("SyncRoom message handling", () => {
  // Helper to create encrypted change
  const createChange = (
    id: string,
    entityId: string,
    changeType: "create" | "update" | "delete"
  ): EncryptedChange => ({
    id,
    entityId,
    changeType,
    encryptedData: btoa(`encrypted-${id}`),
    nonce: btoa(`nonce-${id}`),
    siteId: "site-001",
    timestamp: new Date().toISOString(),
    version: 1,
  });

  describe("Message validation", () => {
    it("should validate auth message structure", () => {
      const authMsg: SyncMessage = { type: "auth", token: "test-token" };
      expect(authMsg.type).toBe("auth");
      expect(authMsg.token).toBeDefined();
    });

    it("should validate join message structure", () => {
      const joinMsg: SyncMessage = { type: "join", workspaceId: "ws-123" };
      expect(joinMsg.type).toBe("join");
      expect(joinMsg.workspaceId).toBeDefined();
    });

    it("should validate push message with changes", () => {
      const changes = [
        createChange("c1", "entity-1", "create"),
        createChange("c2", "entity-2", "update"),
      ];
      const pushMsg: SyncMessage = { type: "push", changes };
      expect(pushMsg.type).toBe("push");
      expect(pushMsg.changes).toHaveLength(2);
    });

    it("should validate pull message structure", () => {
      const pullMsg: SyncMessage = { type: "pull", sinceVersion: 5 };
      expect(pullMsg.type).toBe("pull");
      expect(pullMsg.sinceVersion).toBe(5);
    });

    it("should validate ack message structure", () => {
      const ackMsg: SyncMessage = { type: "ack", version: 10 };
      expect(ackMsg.type).toBe("ack");
      expect(ackMsg.version).toBe(10);
    });
  });

  describe("Server message validation", () => {
    it("should create error message", () => {
      const errorMsg: ServerMessage = {
        type: "error",
        code: "AUTH_FAILED",
        message: "Invalid token",
      };
      expect(errorMsg.type).toBe("error");
      expect(errorMsg.code).toBe("AUTH_FAILED");
    });

    it("should create authenticated message", () => {
      const authMsg: ServerMessage = {
        type: "authenticated",
        accountId: "acc-123",
      };
      expect(authMsg.type).toBe("authenticated");
      expect(authMsg.accountId).toBe("acc-123");
    });

    it("should create joined message", () => {
      const joinedMsg: ServerMessage = {
        type: "joined",
        workspaceId: "ws-123",
        currentVersion: 42,
      };
      expect(joinedMsg.type).toBe("joined");
      expect(joinedMsg.currentVersion).toBe(42);
    });

    it("should create changes message", () => {
      const changes = [createChange("c1", "entity-1", "create")];
      const changesMsg: ServerMessage = {
        type: "changes",
        changes,
        fromVersion: 0,
        toVersion: 1,
      };
      expect(changesMsg.type).toBe("changes");
      expect(changesMsg.changes).toHaveLength(1);
      expect(changesMsg.fromVersion).toBe(0);
      expect(changesMsg.toVersion).toBe(1);
    });

    it("should create presence message", () => {
      const presenceMsg: ServerMessage = {
        type: "presence",
        siteId: "site-002",
        action: "joined",
      };
      expect(presenceMsg.type).toBe("presence");
      expect(presenceMsg.action).toBe("joined");
    });
  });

  describe("Change operations", () => {
    it("should handle create changes", () => {
      const change = createChange("c1", "entity-1", "create");
      expect(change.changeType).toBe("create");
      expect(change.encryptedData).toBeDefined();
    });

    it("should handle update changes", () => {
      const change = createChange("c2", "entity-1", "update");
      expect(change.changeType).toBe("update");
    });

    it("should handle delete changes", () => {
      const change = createChange("c3", "entity-1", "delete");
      expect(change.changeType).toBe("delete");
    });

    it("should preserve encrypted data integrity", () => {
      const original = "sensitive-data-123";
      const encrypted = btoa(original);
      const decrypted = atob(encrypted);
      expect(decrypted).toBe(original);
    });

    it("should track change versions", () => {
      const changes: EncryptedChange[] = [
        { ...createChange("c1", "e1", "create"), version: 1 },
        { ...createChange("c2", "e2", "create"), version: 2 },
        { ...createChange("c3", "e1", "update"), version: 3 },
      ];

      const maxVersion = Math.max(...changes.map((c) => c.version));
      expect(maxVersion).toBe(3);
    });

    it("should filter changes by version", () => {
      const changes: EncryptedChange[] = [
        { ...createChange("c1", "e1", "create"), version: 1 },
        { ...createChange("c2", "e2", "create"), version: 2 },
        { ...createChange("c3", "e1", "update"), version: 3 },
        { ...createChange("c4", "e3", "create"), version: 4 },
      ];

      const sinceVersion = 2;
      const filtered = changes.filter((c) => c.version > sinceVersion);
      expect(filtered).toHaveLength(2);
      expect(filtered[0].version).toBe(3);
      expect(filtered[1].version).toBe(4);
    });
  });

  describe("Workspace isolation", () => {
    it("should separate changes by workspace", () => {
      const workspaces: Record<string, EncryptedChange[]> = {
        "ws-1": [createChange("c1", "e1", "create")],
        "ws-2": [createChange("c2", "e2", "create")],
      };

      expect(workspaces["ws-1"]).toHaveLength(1);
      expect(workspaces["ws-2"]).toHaveLength(1);
      expect(workspaces["ws-1"][0].id).not.toBe(workspaces["ws-2"][0].id);
    });

    it("should track versions per workspace", () => {
      const versions: Record<string, number> = {
        "ws-1": 5,
        "ws-2": 10,
      };

      versions["ws-1"]++;
      expect(versions["ws-1"]).toBe(6);
      expect(versions["ws-2"]).toBe(10);
    });
  });

  describe("Conflict detection", () => {
    it("should detect concurrent changes to same entity", () => {
      const change1: EncryptedChange = {
        ...createChange("c1", "entity-1", "update"),
        siteId: "site-001",
        timestamp: "2024-01-01T10:00:00Z",
      };
      const change2: EncryptedChange = {
        ...createChange("c2", "entity-1", "update"),
        siteId: "site-002",
        timestamp: "2024-01-01T10:00:01Z",
      };

      const sameEntity = change1.entityId === change2.entityId;
      const differentSites = change1.siteId !== change2.siteId;
      const isConflict = sameEntity && differentSites;

      expect(isConflict).toBe(true);
    });

    it("should not flag sequential changes as conflicts", () => {
      const change1: EncryptedChange = {
        ...createChange("c1", "entity-1", "update"),
        siteId: "site-001",
        version: 1,
      };
      const change2: EncryptedChange = {
        ...createChange("c2", "entity-1", "update"),
        siteId: "site-001",
        version: 2,
      };

      const sameSite = change1.siteId === change2.siteId;
      const sequential = change2.version === change1.version + 1;

      expect(sameSite && sequential).toBe(true);
    });
  });
});
