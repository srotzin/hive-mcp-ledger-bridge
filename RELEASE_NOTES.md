# v1.0.0 — Hive Ledger Bridge MCP Server

**Hive Civilization** — 2026-04-29

---

## What this server is

`hive-mcp-ledger-bridge` is a public MCP server (Streamable-HTTP, JSON-RPC 2.0, MCP 2024-11-05) that wraps the EIP-712 over USB/DMK ledger-bridge integration spec — the same spec [`shisa-ai/shisad`](https://github.com/shisa-ai/shisad) implements through `contrib/ledger-bridge`.

Ledger is a partner. This server complements shisad. It does not replace or compete with any layer of the shisad PEP pipeline, the `ConfirmationLevel` enum, or the signer-backend contract.

---

## Tools (5)

| Tool | Description |
|---|---|
| `ledger_intent_envelope_create` | Build an `IntentEnvelope` with EIP-712 domain separator and `intent_envelope_hash` for Ledger device signing |
| `ledger_intent_envelope_verify` | Verify `intent_envelope_hash` matches the canonical hash of an `IntentEnvelope` body |
| `ledger_confirmation_level_query` | Return required `ConfirmationLevel` for an intent (SOFTWARE=0 … TRUSTED_DISPLAY_AUTHORIZATION=4) |
| `ledger_signed_authorization_attest` | Hive-side attestation that an intent reached SIGNED_AUTHORIZATION (L3) or TRUSTED_DISPLAY_AUTHORIZATION (L4) |
| `ledger_partner_directory` | Return partner integration directory: shisa-ai/shisad reference, Ledger Live partner program, Hive contact |

---

## ConfirmationLevel enum (verbatim from shisad)

| Level | Name | Integer |
|---|---|---|
| L0 | SOFTWARE | 0 |
| L1 | REAUTHENTICATED | 1 |
| L2 | BOUND_APPROVAL | 2 |
| L3 | SIGNED_AUTHORIZATION | 3 |
| L4 | TRUSTED_DISPLAY_AUTHORIZATION | 4 |

No extensions. No invented tiers.

---

## Backend

Pairs with: `shisa-ai/shisad contrib/ledger-bridge` + future `hive-ledger-attest` backend.

LLM endpoint (if extended): `https://hivecompute-g2g7.onrender.com/v1/compute/chat/completions`

Treasury: `0x15184bf50b3d3f52b60434f8942b7d52f2eb436e`

---

## Council Provenance

Ad-hoc shim launch. Complements existing Hive identity and settlement surface.
Three gates: NEED (Ledger Surface A, OAuth-blocked on shisa-ai) + YIELD (registry discoverability for Ledger devs and shisad contributors) + CLEAN-MONEY (read-only shim; no settlement, no external markets).

---

## Brand

`#C08D23` — Pantone 1245 C

---

## Registries

- **Glama** — auto-crawls GitHub; claim at `https://glama.ai/mcp/servers/srotzin/hive-mcp-ledger-bridge` after 24-72h
- **MCP.so** — auto-crawls GitHub
- **Smithery** — `smithery.yaml` present; submit manually at `https://smithery.ai/new?repo=srotzin/hive-mcp-ledger-bridge`
- **awesome-mcp-servers** — deferred; bundled with next batch PR

---

*Contact: steve@thehiveryiq.com*
