/**
 * Tests for authentication utilities
 */

import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
} from "../src/auth";

describe("Password hashing", () => {
  it("should hash and verify password correctly", async () => {
    const password = "test-password-123";
    const hash = await hashPassword(password);

    expect(hash).toBeDefined();
    expect(hash).not.toBe(password);

    const valid = await verifyPassword(password, hash);
    expect(valid).toBe(true);
  });

  it("should reject wrong password", async () => {
    const password = "test-password-123";
    const hash = await hashPassword(password);

    const valid = await verifyPassword("wrong-password", hash);
    expect(valid).toBe(false);
  });

  it("should produce different hashes for same password", async () => {
    const password = "test-password-123";
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);

    expect(hash1).not.toBe(hash2); // Different salts
  });
});

describe("Token generation and verification", () => {
  const secret = "test-secret-key";

  it("should generate and verify token", async () => {
    const accountId = "test-account-123";
    const token = await generateToken(accountId, secret);

    expect(token).toBeDefined();
    expect(token.split(".")).toHaveLength(2);

    const payload = await verifyToken(token, secret);
    expect(payload).not.toBeNull();
    expect(payload?.accountId).toBe(accountId);
  });

  it("should reject token with wrong secret", async () => {
    const accountId = "test-account-123";
    const token = await generateToken(accountId, secret);

    const payload = await verifyToken(token, "wrong-secret");
    expect(payload).toBeNull();
  });

  it("should reject malformed token", async () => {
    const payload = await verifyToken("not-a-valid-token", secret);
    expect(payload).toBeNull();
  });

  it("should reject expired token", async () => {
    // Create a token that's already expired
    const expiredPayload = {
      accountId: "test-account",
      iat: Math.floor(Date.now() / 1000) - 86400 * 8, // 8 days ago
      exp: Math.floor(Date.now() / 1000) - 86400, // Expired 1 day ago
    };

    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(expiredPayload));

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign("HMAC", key, data);
    const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
    const token = `${btoa(JSON.stringify(expiredPayload))}.${sigBase64}`;

    const payload = await verifyToken(token, secret);
    expect(payload).toBeNull();
  });
});
