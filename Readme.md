# Verification + Reputation on ERC-8004 

  

This guide is the single runbook for running, demoing, troubleshooting, and extending this project.

  

## 1) What This Project Does

  

This router validates agent task payloads and writes a 0-100 score to ERC-8004 Validation Registry.

  

Input payload at `requestURI`:

- `agentId`

- `mandate` (with `core.kind`, `core.payload`, signatures)

- `receipt`

  

Flow:

1. Fetch payload from `requestURI`

2. Verify payload hash (`requestHash`)

3. Route by `mandate.core.kind`

4. Run verifiers

5. Aggregate score (`average`)

6. Submit `validationResponse(...)`

  

## 2) Current Capabilities

  

Implemented:

- Router service (`POST /validate`)

- Verifier routing by `core.kind`

- `Mandate Integrity` verifier

- `Primitive Receipt` verifier for `swap@1`

- Score aggregation to `0-100`

- `responseURI` generation with score breakdown

- Demo trust endpoint in `DEMO_MODE`: `GET /trust/:agentId`

  

Also added for demo velocity:

- `DEMO_MODE=true` bypasses on-chain writes and stores trust in local memory

  

## 3) Prerequisites

  

- Node.js 18+

- npm

- Optional for chain debugging: Foundry `cast`

- Optional on-chain: funded wallet on target network

  

## 4) Environment Variables

  

Create `.env` in repo root.

  

Minimum (demo mode):

  

```env

DEMO_MODE=true

PORT=3000

```

  

On-chain mode:

  

```env

DEMO_MODE=false

RPC_URL=https://sepolia.base.org

PRIVATE_KEY=<64-hex-no-0x>

REGISTRY_ADDRESS=<ValidationRegistry address>

ROUTER_ADDRESS=<validator/router address>

PORT=3000

POLL_INTERVAL_MS=15000

```

  

Notes:

- If `ROUTER_ADDRESS` is missing, code derives it from `PRIVATE_KEY`.

- In on-chain mode, wrong key/network/address combos are the most common failure reason.

  

## 5) Install + Start

  

```bash

npm install

npm run dev

```

  

Health check:

  

```bash

curl http://localhost:3000/health

```

  

Expected in demo:

- `"demoMode": true`

  

## 6) Fastest Demo (No Chain Dependencies)

  

Run with `DEMO_MODE=true`.

  

Trigger validation:

  

```bash

curl -X POST http://localhost:3000/validate \

-H "Content-Type: application/json" \

-d '{"agentId":1,"requestURI":"http://localhost:3000/test-payload"}'

```

  

Read trust snapshot:

  

```bash

curl http://localhost:3000/trust/1

```

  

What this demonstrates:

- Mandate + receipt parsing

- Verifier routing

- Score calculation

- Score history and latest/average trust view

  

## 7) On-Chain End-to-End (Real Validation Registry)

  

Set `DEMO_MODE=false` and configure `.env`.

  

Start router:

  

```bash

npm run dev

```

  

Run e2e script (recommended):

  

```bash

npm run test:e2e

```

  

Script behavior:

1. Ensures/creates agent

2. Builds signed payload and serves it

3. Sends `validationRequest(...)`

4. Waits for router response

5. Prints returned score

  

## 8) API Reference

  

### POST `/validate`

  

Supported body shapes:

  

Mode A (on-chain callback style):

  

```json

{

"requestHash": "0x...",

"requestURI": "http://... or ipfs://..."

}

```

  

Mode B (manual/dev style):

  

```json

{

"agentId": 1,

"requestURI": "http://... or ipfs://..."

}

```

  

Behavior:

- If `requestHash` is provided: validate + respond

- Else with `agentId`: compute hash from payload, submit `validationRequest`, then validate + respond

- In `DEMO_MODE`, chain tx is skipped with mock tx ids

  

### GET `/trust/:agentId`

  

- Available in `DEMO_MODE=true`

- Returns local trust snapshot: `validationCount`, `latestScore`, `averageScore`, history

  

### GET `/test-payload`

  

Returns a signed fixture payload for quick tests.

  

### GET `/test-hash`

  

Returns hash + URI pair for the fixture payload.

  

## 9) Common Failures + Fixes

  

### `Not authorized` on `validationRequest`

  

Meaning:

- Caller is not owner/approved operator for `agentId` in IdentityRegistry.

  

Fix:

1. Get identity registry from validation registry:

  

```bash

cast call $REGISTRY "getIdentityRegistry()(address)" --rpc-url $RPC_URL

```

  

2. Check ownership:

  

```bash

cast call $IDENTITY "ownerOf(uint256)(address)" $AGENT_ID --rpc-url $RPC_URL

```

  

3. Authorize validator from owner wallet:

  

```bash

cast send $IDENTITY "approve(address,uint256)" $VALIDATOR $AGENT_ID \

--private-key $OWNER_PRIVATE_KEY --rpc-url $RPC_URL

```

  

or

  

```bash

cast send $IDENTITY "setApprovalForAll(address,bool)" $VALIDATOR true \

--private-key $OWNER_PRIVATE_KEY --rpc-url $RPC_URL

```

  

### `unknown` on `validationResponse`

  

Meaning:

- `requestHash` not registered on-chain first.

  

Fix:

- Ensure `validationRequest(...)` succeeded before response.

- Use `npm run test:e2e` path.

  

### Payload hash mismatch

  

Meaning:

- Computed bytes hash != provided `requestHash`.

  

Fix:

- Ensure exact same payload bytes at `requestURI`.

- Avoid reformatting JSON between hash generation and serving.

  

## 10) How Scoring Works

  

Per verifier:

- output: `name`, `score (0-100)`, optional notes

  

Aggregation:

- `finalScore = average(verifier scores)`

- clamped to `0-100`

  

Current verifiers:

- `Mandate Integrity`

- `Primitive Receipt` for `swap@1`

  

## 11) Add a New Verifier / New `core.kind`

  

1. Create verifier file under `src/verifiers/` implementing `verify(mandate, receipt)`

2. Return a deterministic `0-100` score and notes

3. Register it in `src/router/verifierRegistry.ts`

4. Map it to target `core.kind` (for example `lend@1`)

5. Add fixture payload for this kind (optional but recommended)

6. Add tests (unit + integration)

7. Rebuild and run demo

  

Verifier quality rules:

- Prefer deterministic checks

- Explicitly tie checks to `mandate.core.payload`

- Keep failure notes actionable

  

## 12) Extension Guidelines

  

Recommended next upgrades:

- Persist trust data in DB (SQLite/Postgres/Redis)

- Use IPFS for `responseURI` instead of `data:` URI

- Replace global nonce handling with safer nonce manager

- Add preflight auth checks before tx send

- Add request queue and metrics

- Add sybil-resistance heuristics

  

## 13) Known Differences vs Strict Spec Behavior

  

- `DEMO_MODE` can bypass on-chain writes for presentations

- Demo trust endpoint is local-memory trust, not canonical on-chain trust

- `responseURI` currently uses `data:` URI for MVP simplicity

  

## 14) Demo Script (Talk Track)

  

1. Start router in demo mode

2. Call `/validate` with `agentId + requestURI`

3. Show logs for verifier execution + final score

4. Call `/trust/:agentId` and show latest + average score

5. Explain how same flow maps to on-chain mode by toggling `DEMO_MODE=false`

  

## 15) Quick Command Block

  

```bash

# Demo mode

export DEMO_MODE=true

export PORT=3000

npm run dev

  

# In another terminal

curl -X POST http://localhost:3000/validate \

-H "Content-Type: application/json" \

-d '{"agentId":1,"requestURI":"http://localhost:3000/test-payload"}'

  

curl http://localhost:3000/trust/1

curl http://localhost:3000/health
