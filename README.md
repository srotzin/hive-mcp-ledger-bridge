# hive-mcp-ledger-bridge

**Hive Civilization** — EIP-712 over USB/DMK ledger-bridge MCP server.

Implements the same signer-backend contract that [shisa-ai/shisad](https://github.com/shisa-ai/shisad) exposes through `contrib/ledger-bridge`. Ledger is a partner. This server complements shisad — it does not replace it.

---

## Partner Doctrine

| Layer | Operator | Function |
|---|---|---|
| Hardware countersignature | Ledger device | EIP-712 signature over `intent_envelope_hash` after on-device review |
| ledger-bridge | shisa-ai (in `contrib/`) | Signer-backend contract; HTTP-to-USB/DMK adapter |
| 8-layer PEP + ConfirmationLevel | shisad | Per-call policy enforcement; routes confirmation to backend |
| DID resolution + identity passport | Hive (`hivetrust`, `hive-mcp-identity`) | Read-only identity surface |
| Spectral receipts | Hive | Settlement audit record per fee event |

No overlap. The hardware tier remains Ledger's. The runtime policy tier remains shisad's. Hive contributes IntentEnvelope construction, hash verification, confirmation-level policy, and settlement attestation — all above the PEP, without modifying the `ConfirmationLevel` enum or the signer-backend contract.

---

## ConfirmationLevel Enum

From the `shisa-ai/shisad` specification:

| Level | Name | Integer |
|---|---|---|
| L0 | `SOFTWARE` | 0 |
| L1 | `REAUTHENTICATED` | 1 |
| L2 | `BOUND_APPROVAL` | 2 |
| L3 | `SIGNED_AUTHORIZATION` | 3 |
| L4 | `TRUSTED_DISPLAY_AUTHORIZATION` | 4 |

This server uses the enum verbatim. No extensions, no invented tiers.

---

## Tools

| Tool | Description | Default ConfirmationLevel |
|---|---|---|
| `ledger_intent_envelope_create` | Build an `IntentEnvelope` with EIP-712 domain separator and `intent_envelope_hash` | Derived from `action` |
| `ledger_intent_envelope_verify` | Verify `intent_envelope_hash` matches envelope contents | Read-only / none |
| `ledger_confirmation_level_query` | Return required `ConfirmationLevel` for an intent | Read-only / none |
| `ledger_signed_authorization_attest` | Hive-side attestation that an intent reached L3 or L4 | L3 / L4 required |
| `ledger_partner_directory` | Partner integration directory: shisad reference, Ledger Live, Hive contact | Read-only / none |

### `ledger_intent_envelope_create`

Build a signed-ready `IntentEnvelope`. The server produces the EIP-712 domain separator and `intent_envelope_hash` — the hash is what the Ledger device signs.

```json
{
  "intent_id": "uuid-or-did-fragment",
  "agent_did": "did:hive:0xabc...",
  "action": "transfer",
  "target": "0xRecipientAddress",
  "amount": "1000.00",
  "chain_id": 8453,
  "nonce": 1,
  "deadline": 1777699200,
  "verifying_contract": "0x0000000000000000000000000000000000000000"
}
```

Response includes `envelope`, `intent_envelope_hash`, `domain_separator`, and `suggested_confirmation_level`.

### `ledger_intent_envelope_verify`

Supply an `IntentEnvelope` body and an `intent_envelope_hash`. Returns `match: true|false` and the recomputed hash.

### `ledger_confirmation_level_query`

```json
{ "action": "transfer", "amount_usd": 50000 }
```

Returns the integer level and name. Useful for pre-call policy checks before routing to the ledger-bridge.

### `ledger_signed_authorization_attest`

Record a Hive-side attestation that a device returned an ECDSA signature at L3 or L4. This is not on-chain settlement — it is an audit record that the intent_envelope_hash was device-countersigned.

```json
{
  "intent_envelope_hash": "0xabc...",
  "agent_did": "did:hive:0xabc...",
  "confirmation_level": 4,
  "ecdsa_signature": "0xsignatureHex..."
}
```

### `ledger_partner_directory`

Returns the full partner directory with URLs, roles, and contact information.

---

## Endpoints

| Path | Method | Description |
|---|---|---|
| `/health` | GET | Service health and version |
| `/.well-known/mcp.json` | GET | MCP manifest |
| `/mcp` | POST | JSON-RPC 2.0 (MCP 2024-11-05) |

---

## Connect

**MCP endpoint:** `https://hiveledgerbridge.onrender.com/mcp` *(pairs with shisa-ai/shisad contrib/ledger-bridge + future hive-ledger-attest backend)*

### JSON-RPC 2.0 — tools/list

```bash
curl -s -X POST https://hiveledgerbridge.onrender.com/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### JSON-RPC 2.0 — ledger_intent_envelope_create

```bash
curl -s -X POST https://hiveledgerbridge.onrender.com/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":2,"method":"tools/call",
    "params":{
      "name":"ledger_intent_envelope_create",
      "arguments":{
        "intent_id":"550e8400-e29b-41d4-a716-446655440000",
        "agent_did":"did:hive:0xabc",
        "action":"transfer",
        "target":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "chain_id":8453,
        "nonce":1,
        "deadline":1777699200
      }
    }
  }'
```

---

## Integration with shisad

`shisa-ai/shisad` routes `trusted_display_authorization` (L4) intents through `contrib/ledger-bridge` — the daemon POSTs an `IntentEnvelope` plus `intent_envelope_hash` to the bridge, the user reviews on the Ledger device, and the ECDSA signature returns to the daemon.

This server speaks the same `IntentEnvelope` / `intent_envelope_hash` vocabulary. A shisad deployment can use `ledger_intent_envelope_create` upstream of the bridge call, `ledger_intent_envelope_verify` on the returned hash, and `ledger_signed_authorization_attest` to anchor the device signature as a Hive Spectral receipt.

Operator policy continues to control `ConfirmationLevel` through the standard `tools."x".confirmation.level` config — no new mechanism required.

---

## Infrastructure

| Property | Value |
|---|---|
| Transport | Streamable-HTTP, JSON-RPC 2.0, MCP 2024-11-05 |
| Runtime | Node.js ≥ 18, ESM |
| LLM (if extended) | `https://hivecompute-g2g7.onrender.com/v1/compute/chat/completions` |
| Treasury | `0x15184bf50b3d3f52b60434f8942b7d52f2eb436e` |
| USDC (Base) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Brand | `#C08D23` |
| Spec reference | [shisa-ai/shisad contrib/ledger-bridge](https://github.com/shisa-ai/shisad) |
| Ledger partner program | [developers.ledger.com](https://developers.ledger.com/docs/live-app/start-here/) |

---

## License

MIT — see [LICENSE](LICENSE).

Contact: steve@thehiveryiq.com

## Hive Civilization Directory

Part of the Hive Civilization — agent-native financial infrastructure.

- Endpoint Directory: https://thehiveryiq.com
- Live Leaderboard: https://hive-a2amev.onrender.com/leaderboard
- Revenue Dashboard: https://hivemine-dashboard.onrender.com
- Other MCP Servers: https://github.com/srotzin?tab=repositories&q=hive-mcp

Brand: #C08D23
<!-- /hive-footer -->
