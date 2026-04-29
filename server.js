import express from "express";
import { createHash } from "crypto";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ─── ConfirmationLevel enum ────────────────────────────────────────────────
const ConfirmationLevel = {
  SOFTWARE: 0,
  REAUTHENTICATED: 1,
  BOUND_APPROVAL: 2,
  SIGNED_AUTHORIZATION: 3,
  TRUSTED_DISPLAY_AUTHORIZATION: 4,
};

const ConfirmationLevelName = {
  0: "SOFTWARE",
  1: "REAUTHENTICATED",
  2: "BOUND_APPROVAL",
  3: "SIGNED_AUTHORIZATION",
  4: "TRUSTED_DISPLAY_AUTHORIZATION",
};

// ─── EIP-712 domain separator ─────────────────────────────────────────────
function buildEip712DomainSeparator(chainId, verifyingContract) {
  const raw = JSON.stringify({
    name: "HiveLedgerBridge",
    version: "1",
    chainId,
    verifyingContract,
  });
  return createHash("sha256").update(raw).digest("hex");
}

// ─── IntentEnvelope builder ────────────────────────────────────────────────
function buildIntentEnvelope(params) {
  const {
    intent_id,
    agent_did,
    action,
    target,
    amount,
    chain_id,
    nonce,
    deadline,
    verifying_contract,
  } = params;

  const domain_separator = buildEip712DomainSeparator(
    chain_id,
    verifying_contract || "0x0000000000000000000000000000000000000000"
  );

  const envelope_body = {
    intent_id,
    agent_did,
    action,
    target,
    amount: amount || null,
    chain_id,
    nonce,
    deadline,
    domain_separator,
    schema_version: "1.0.0",
    created_at: new Date().toISOString(),
  };

  const canonical = JSON.stringify(envelope_body, Object.keys(envelope_body).sort());
  const intent_envelope_hash = createHash("sha256").update(canonical).digest("hex");

  return { envelope: envelope_body, intent_envelope_hash, domain_separator };
}

// ─── ConfirmationLevel policy ──────────────────────────────────────────────
function resolveConfirmationLevel(action, amount_usd) {
  if (!action) return ConfirmationLevel.SOFTWARE;

  const actionLower = action.toLowerCase();

  // Highest tier: any on-chain settlement
  if (
    actionLower.includes("transfer") ||
    actionLower.includes("send") ||
    actionLower.includes("settle") ||
    actionLower.includes("authorize_spend") ||
    (amount_usd && Number(amount_usd) >= 10000)
  ) {
    return ConfirmationLevel.TRUSTED_DISPLAY_AUTHORIZATION;
  }

  // SIGNED_AUTHORIZATION: sub-threshold value transfers or signed commitments
  if (
    actionLower.includes("sign") ||
    actionLower.includes("commit") ||
    (amount_usd && Number(amount_usd) >= 1000)
  ) {
    return ConfirmationLevel.SIGNED_AUTHORIZATION;
  }

  // BOUND_APPROVAL: approve or delegate without immediate settlement
  if (
    actionLower.includes("approve") ||
    actionLower.includes("delegate")
  ) {
    return ConfirmationLevel.BOUND_APPROVAL;
  }

  // REAUTHENTICATED: sensitive reads or session refresh
  if (
    actionLower.includes("session") ||
    actionLower.includes("reauth") ||
    actionLower.includes("export")
  ) {
    return ConfirmationLevel.REAUTHENTICATED;
  }

  // SOFTWARE: default read-only
  return ConfirmationLevel.SOFTWARE;
}

// ─── MCP tools registry ────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "ledger_intent_envelope_create",
    description:
      "Build an IntentEnvelope with EIP-712 domain separator and intent_envelope_hash for Ledger device signing. " +
      "Implements the signer-backend contract from shisa-ai/shisad contrib/ledger-bridge.",
    inputSchema: {
      type: "object",
      properties: {
        intent_id: {
          type: "string",
          description: "Unique identifier for this intent (UUID or DID fragment)",
        },
        agent_did: {
          type: "string",
          description: "W3C DID of the requesting agent",
        },
        action: {
          type: "string",
          description:
            "Action label (e.g. transfer, sign, approve). Used to determine default ConfirmationLevel.",
        },
        target: {
          type: "string",
          description: "Target address or DID for the action",
        },
        amount: {
          type: "string",
          description: "Amount as a decimal string (optional)",
        },
        chain_id: {
          type: "number",
          description: "EVM chain ID (e.g. 8453 for Base)",
        },
        nonce: {
          type: "number",
          description: "Monotonic nonce preventing replay",
        },
        deadline: {
          type: "number",
          description: "Unix timestamp after which the envelope is invalid",
        },
        verifying_contract: {
          type: "string",
          description:
            "EIP-712 verifyingContract address. Defaults to zero address for off-chain intents.",
        },
      },
      required: ["intent_id", "agent_did", "action", "chain_id", "nonce", "deadline"],
    },
  },
  {
    name: "ledger_intent_envelope_verify",
    description:
      "Verify that a supplied intent_envelope_hash matches the canonical hash of an IntentEnvelope body. " +
      "Returns match=true|false and the recomputed hash.",
    inputSchema: {
      type: "object",
      properties: {
        envelope: {
          type: "object",
          description: "IntentEnvelope body as returned by ledger_intent_envelope_create",
        },
        intent_envelope_hash: {
          type: "string",
          description: "Hash to verify against the envelope body",
        },
      },
      required: ["envelope", "intent_envelope_hash"],
    },
  },
  {
    name: "ledger_confirmation_level_query",
    description:
      "Return the required ConfirmationLevel for an intent based on action type and optional amount. " +
      "Returns the integer level (0–4) and its name from the ConfirmationLevel enum " +
      "(SOFTWARE=0, REAUTHENTICATED=1, BOUND_APPROVAL=2, SIGNED_AUTHORIZATION=3, TRUSTED_DISPLAY_AUTHORIZATION=4).",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Action label for the intent",
        },
        amount_usd: {
          type: "number",
          description: "USD value of the action (optional, influences tier)",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "ledger_signed_authorization_attest",
    description:
      "Hive-side attestation that an intent_envelope_hash has reached SIGNED_AUTHORIZATION (level 3) " +
      "or TRUSTED_DISPLAY_AUTHORIZATION (level 4). Stores the attestation record against the agent DID. " +
      "Does not perform on-chain settlement — attestation only.",
    inputSchema: {
      type: "object",
      properties: {
        intent_envelope_hash: {
          type: "string",
          description: "Hash returned by the Ledger device after signing",
        },
        agent_did: {
          type: "string",
          description: "W3C DID of the agent whose intent was signed",
        },
        confirmation_level: {
          type: "number",
          description: "Achieved ConfirmationLevel (must be 3 or 4)",
          enum: [3, 4],
        },
        ecdsa_signature: {
          type: "string",
          description: "Hex-encoded ECDSA signature returned by the Ledger device (optional for record)",
        },
      },
      required: ["intent_envelope_hash", "agent_did", "confirmation_level"],
    },
  },
  {
    name: "ledger_partner_directory",
    description:
      "Return the Hive ledger-bridge partner integration directory: shisa-ai/shisad reference, " +
      "Ledger Live partner program link, and brand-attributed Hive contact.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// ─── Attestation store (in-memory; stateless across restarts — production pairs with hive-ledger-attest backend) ──
const attestations = new Map();

// ─── Health ────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "hive-mcp-ledger-bridge",
    version: "1.0.0",
    pairs_with: "shisa-ai/shisad contrib/ledger-bridge + future hive-ledger-attest",
    treasury: "0x15184bf50b3d3f52b60434f8942b7d52f2eb436e",
    brand: "#C08D23",
    ts: new Date().toISOString(),
  });
});

// ─── MCP well-known ────────────────────────────────────────────────────────
app.get("/.well-known/mcp.json", (_req, res) => {
  res.json({
    schema_version: "2024-11-05",
    name: "hive-mcp-ledger-bridge",
    description:
      "Hive MCP server implementing the EIP-712 over USB/DMK ledger-bridge integration spec. " +
      "Complements shisa-ai/shisad contrib/ledger-bridge — Ledger is a partner, not a competitor.",
    transport: "streamable-http",
    endpoint: "/mcp",
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
  });
});

// ─── MCP endpoint ──────────────────────────────────────────────────────────
app.post("/mcp", async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  if (jsonrpc !== "2.0") {
    return res.status(400).json({
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code: -32600, message: "Invalid JSON-RPC version" },
    });
  }

  // tools/list
  if (method === "tools/list") {
    return res.json({
      jsonrpc: "2.0",
      id,
      result: { tools: TOOLS },
    });
  }

  // tools/call
  if (method === "tools/call") {
    const { name, arguments: args = {} } = params || {};

    try {
      let content;

      // ── ledger_intent_envelope_create ────────────────────────────────────
      if (name === "ledger_intent_envelope_create") {
        const { envelope, intent_envelope_hash, domain_separator } =
          buildIntentEnvelope(args);

        const level = resolveConfirmationLevel(args.action, null);
        const level_name = ConfirmationLevelName[level];

        content = {
          ok: true,
          envelope,
          intent_envelope_hash,
          domain_separator,
          suggested_confirmation_level: level,
          suggested_confirmation_level_name: level_name,
          spec_reference: "shisa-ai/shisad contrib/ledger-bridge",
          pairs_with: "shisa-ai/shisad contrib/ledger-bridge + future hive-ledger-attest",
        };

      // ── ledger_intent_envelope_verify ────────────────────────────────────
      } else if (name === "ledger_intent_envelope_verify") {
        const { envelope, intent_envelope_hash } = args;
        const canonical = JSON.stringify(
          envelope,
          Object.keys(envelope).sort()
        );
        const recomputed = createHash("sha256").update(canonical).digest("hex");
        const match = recomputed === intent_envelope_hash;

        content = {
          ok: true,
          match,
          recomputed_hash: recomputed,
          supplied_hash: intent_envelope_hash,
          note: match
            ? "intent_envelope_hash matches envelope contents."
            : "Hash mismatch — envelope may have been tampered or field order differs.",
        };

      // ── ledger_confirmation_level_query ──────────────────────────────────
      } else if (name === "ledger_confirmation_level_query") {
        const level = resolveConfirmationLevel(args.action, args.amount_usd);
        const level_name = ConfirmationLevelName[level];

        content = {
          ok: true,
          action: args.action,
          confirmation_level: level,
          confirmation_level_name: level_name,
          enum_reference: {
            SOFTWARE: 0,
            REAUTHENTICATED: 1,
            BOUND_APPROVAL: 2,
            SIGNED_AUTHORIZATION: 3,
            TRUSTED_DISPLAY_AUTHORIZATION: 4,
          },
          spec_reference: "shisa-ai/shisad ConfirmationLevel enum",
        };

      // ── ledger_signed_authorization_attest ───────────────────────────────
      } else if (name === "ledger_signed_authorization_attest") {
        const {
          intent_envelope_hash,
          agent_did,
          confirmation_level,
          ecdsa_signature,
        } = args;

        if (![3, 4].includes(Number(confirmation_level))) {
          return res.json({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message:
                "confirmation_level must be 3 (SIGNED_AUTHORIZATION) or 4 (TRUSTED_DISPLAY_AUTHORIZATION)",
            },
          });
        }

        const attestation_id = createHash("sha256")
          .update(`${intent_envelope_hash}:${agent_did}:${Date.now()}`)
          .digest("hex");

        const record = {
          attestation_id,
          intent_envelope_hash,
          agent_did,
          confirmation_level: Number(confirmation_level),
          confirmation_level_name: ConfirmationLevelName[Number(confirmation_level)],
          ecdsa_signature: ecdsa_signature || null,
          attested_at: new Date().toISOString(),
          attested_by: "hive-mcp-ledger-bridge v1.0.0",
          treasury: "0x15184bf50b3d3f52b60434f8942b7d52f2eb436e",
          note: "Attestation only. No on-chain settlement performed by this service.",
        };

        attestations.set(attestation_id, record);

        content = { ok: true, ...record };

      // ── ledger_partner_directory ─────────────────────────────────────────
      } else if (name === "ledger_partner_directory") {
        content = {
          ok: true,
          partners: [
            {
              name: "shisa-ai/shisad",
              role: "Reference implementation of the 8-layer PEP and ConfirmationLevel enum. " +
                "contrib/ledger-bridge implements the signer-backend contract for Ledger devices via DMK and EIP-712.",
              url: "https://github.com/shisa-ai/shisad",
              ledger_bridge_path: "contrib/ledger-bridge",
              relationship: "Complementary — this server wraps the same spec; does not replace shisad.",
            },
            {
              name: "Ledger Live Partner Program",
              role: "Hardware countersignature layer. EIP-712 signature over intent_envelope_hash " +
                "after on-device review. Ledger is a partner, not a competitor.",
              url: "https://developers.ledger.com/docs/live-app/start-here/",
              relationship: "Partner — hardware tier remains Ledger's.",
            },
            {
              name: "Hive Civilization",
              role: "DID-federated identity, trust score, x402 + MPP payment rails, and Spectral receipts. " +
                "Identity and settlement composition layer above the hardware enforcement tier.",
              contact: "steve@thehiveryiq.com",
              trust_endpoint: "https://hivetrust.onrender.com",
              identity_endpoint: "https://hive-mcp-identity.onrender.com",
              treasury: "0x15184bf50b3d3f52b60434f8942b7d52f2eb436e",
              brand: "#C08D23",
            },
          ],
          spec_reference: "shisa-ai/shisad contrib/ledger-bridge",
        };

      } else {
        return res.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${name}` },
        });
      }

      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(content, null, 2) }],
        },
      });
    } catch (err) {
      return res.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: err.message },
      });
    }
  }

  return res.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
});

app.listen(PORT, () => {
  console.log(`hive-mcp-ledger-bridge listening on port ${PORT}`);
});
