/**
 * Authentication utilities for chora-cloud
 *
 * Uses simple token-based auth with KV storage for accounts.
 * Passwords are hashed with Web Crypto API (PBKDF2 in Workers).
 */

import type {
  Account,
  AuthToken,
  CreateAccountRequest,
  LoginRequest,
  LoginResponse,
  Env,
} from "./types";

const TOKEN_EXPIRY_HOURS = 24 * 7; // 7 days

/**
 * Hash password using PBKDF2 (Web Crypto API compatible)
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  // Combine salt + hash for storage
  const combined = new Uint8Array(salt.length + hash.byteLength);
  combined.set(salt);
  combined.set(new Uint8Array(hash), salt.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Verify password against stored hash
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const combined = Uint8Array.from(atob(storedHash), (c) => c.charCodeAt(0));

  const salt = combined.slice(0, 16);
  const expectedHash = combined.slice(16);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  const hashArray = new Uint8Array(hash);

  // Constant-time comparison
  if (hashArray.length !== expectedHash.length) return false;
  let result = 0;
  for (let i = 0; i < hashArray.length; i++) {
    result |= hashArray[i] ^ expectedHash[i];
  }
  return result === 0;
}

/**
 * Generate auth token
 */
export async function generateToken(
  accountId: string,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthToken = {
    accountId,
    iat: now,
    exp: now + TOKEN_EXPIRY_HOURS * 3600,
  };

  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, data);
  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return `${btoa(JSON.stringify(payload))}.${sigBase64}`;
}

/**
 * Verify and decode auth token
 */
export async function verifyToken(
  token: string,
  secret: string
): Promise<AuthToken | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;

  try {
    const encoder = new TextEncoder();
    const payload: AuthToken = JSON.parse(atob(payloadB64));

    // Check expiration
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    // Verify signature
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const data = encoder.encode(JSON.stringify(payload));
    const signature = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));

    const valid = await crypto.subtle.verify("HMAC", key, signature, data);
    return valid ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Create a new account
 */
export async function createAccount(
  kv: KVNamespace,
  request: CreateAccountRequest
): Promise<Account> {
  const email = request.email.toLowerCase().trim();

  // Check if account exists
  const existing = await kv.get(`account:email:${email}`);
  if (existing) {
    throw new Error("Account already exists");
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(request.password);
  const now = new Date().toISOString();

  const account: Account = {
    id,
    email,
    passwordHash,
    workspaces: [],
    createdAt: now,
    lastLoginAt: now,
  };

  // Store account by ID and email index
  await kv.put(`account:${id}`, JSON.stringify(account));
  await kv.put(`account:email:${email}`, id);

  return account;
}

/**
 * Login and get token
 */
export async function login(
  kv: KVNamespace,
  secret: string,
  request: LoginRequest
): Promise<LoginResponse> {
  const email = request.email.toLowerCase().trim();

  // Get account ID by email
  const accountId = await kv.get(`account:email:${email}`);
  if (!accountId) {
    throw new Error("Invalid credentials");
  }

  // Get account
  const accountJson = await kv.get(`account:${accountId}`);
  if (!accountJson) {
    throw new Error("Invalid credentials");
  }

  const account: Account = JSON.parse(accountJson);

  // Verify password
  const valid = await verifyPassword(request.password, account.passwordHash);
  if (!valid) {
    throw new Error("Invalid credentials");
  }

  // Update last login
  account.lastLoginAt = new Date().toISOString();
  await kv.put(`account:${accountId}`, JSON.stringify(account));

  // Generate token
  const token = await generateToken(accountId, secret);
  const expiresAt = new Date(
    Date.now() + TOKEN_EXPIRY_HOURS * 3600 * 1000
  ).toISOString();

  return { token, accountId, expiresAt };
}

/**
 * Get account by ID
 */
export async function getAccount(
  kv: KVNamespace,
  accountId: string
): Promise<Account | null> {
  const json = await kv.get(`account:${accountId}`);
  return json ? JSON.parse(json) : null;
}
