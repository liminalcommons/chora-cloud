# chora-cloud

Cloudflare Workers sync service for chora workspaces.

## Overview

chora-cloud provides E2E encrypted sync between chora workspaces:

- **Zero-knowledge**: Server never sees unencrypted data
- **Real-time**: WebSocket sync via Durable Objects
- **REST fallback**: HTTP API for offline-first clients
- **Account management**: Simple email/password auth

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare Edge (300+ cities)                                   │
│                                                                  │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────┐ │
│  │   Worker     │───►│  Durable Object  │───►│      KV       │ │
│  │  (Router)    │    │   (SyncRoom)     │    │  (Accounts)   │ │
│  └──────────────┘    └──────────────────┘    └───────────────┘ │
│         │                    │                                   │
│         │              WebSocket                                 │
│         │                    │                                   │
└─────────┼────────────────────┼───────────────────────────────────┘
          │                    │
    ┌─────┴─────┐        ┌─────┴─────┐
    │ Client A  │        │ Client B  │
    │ (chora)   │        │ (chora)   │
    └───────────┘        └───────────┘
```

## API Routes

### Account Management

```bash
# Create account
curl -X POST https://chora-cloud.workers.dev/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "secure-password"}'

# Login
curl -X POST https://chora-cloud.workers.dev/api/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "secure-password"}'
```

### Workspace Management

```bash
# Create workspace (requires auth)
curl -X POST https://chora-cloud.workers.dev/api/workspaces \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "encrypted-workspace-name"}'

# List workspaces
curl https://chora-cloud.workers.dev/api/workspaces \
  -H "Authorization: Bearer <token>"
```

### Sync (WebSocket)

```javascript
const ws = new WebSocket("wss://chora-cloud.workers.dev/sync/<workspaceId>");

// Authenticate
ws.send(JSON.stringify({ type: "auth", token: "<token>" }));

// Join workspace
ws.send(JSON.stringify({ type: "join", workspaceId: "<workspaceId>" }));

// Push encrypted changes
ws.send(JSON.stringify({
  type: "push",
  changes: [{ id: "...", encryptedData: "...", ... }]
}));

// Pull changes
ws.send(JSON.stringify({ type: "pull", sinceVersion: 0 }));
```

### Sync (REST)

```bash
# Push changes
curl -X POST https://chora-cloud.workers.dev/sync/<workspaceId>/changes \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '[{"id": "...", "encryptedData": "...", ...}]'

# Pull changes
curl "https://chora-cloud.workers.dev/sync/<workspaceId>/changes?since=0" \
  -H "Authorization: Bearer <token>"
```

## Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Run tests
npm test

# Deploy
npm run deploy
```

## Configuration

Create KV namespace and update `wrangler.toml`:

```bash
wrangler kv:namespace create ACCOUNTS
wrangler kv:namespace create ACCOUNTS --preview
```

Set sync secret:

```bash
wrangler secret put SYNC_SECRET
```

## Security

- Passwords hashed with PBKDF2 (100k iterations)
- Tokens signed with HMAC-SHA256
- All entity data E2E encrypted (XChaCha20-Poly1305)
- Server only sees encrypted blobs
