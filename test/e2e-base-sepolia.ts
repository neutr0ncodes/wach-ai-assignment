/**
 * End-to-end integration test on Base Sepolia.
 *
 * Prerequisites:
 *   1. A funded wallet on Base Sepolia (set PRIVATE_KEY in .env)
 *   2. RPC_URL pointing to Base Sepolia (e.g. https://sepolia.base.org)
 *   3. REGISTRY_ADDRESS set to the deployed ValidationRegistry on Base Sepolia
 *   4. The router running (npm run dev) so it can pick up and respond to the request
 *
 * Run:
 *   npx tsx test/e2e-base-sepolia.ts
 *
 * What it does:
 *   1. Registers an agent in the IdentityRegistry (or reuses existing)
 *   2. Creates a signed test payload and starts a tiny HTTP server to serve it
 *   3. Submits a validationRequest on-chain pointing at ROUTER_ADDRESS
 *   4. Polls getValidationStatus until the router responds (up to 3 min)
 *   5. Reports the on-chain response
 */

import "dotenv/config";
import http from "node:http";
import { ethers } from "ethers";
import { Mandate as CoreMandate, caip10 } from "@quillai-network/mandates-core";
import { VALIDATION_REGISTRY_ABI } from "../src/contracts/ValidationRegistry.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const VALIDATION_REGISTRY = process.env.REGISTRY_ADDRESS;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const IDENTITY_REGISTRY =
  process.env.IDENTITY_REGISTRY_ADDRESS ?? "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const PAYLOAD_PORT = 4567;

const IDENTITY_REGISTRY_ABI =    [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "implementation",
        "type": "address"
      }
    ],
    "name": "ERC1967InvalidImplementation",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ERC1967NonPayable",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "ERC721IncorrectOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "operator",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "ERC721InsufficientApproval",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "approver",
        "type": "address"
      }
    ],
    "name": "ERC721InvalidApprover",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "operator",
        "type": "address"
      }
    ],
    "name": "ERC721InvalidOperator",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "ERC721InvalidOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      }
    ],
    "name": "ERC721InvalidReceiver",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "ERC721InvalidSender",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "ERC721NonexistentToken",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "FailedCall",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidInitialization",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotInitializing",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "OwnableInvalidOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "OwnableUnauthorizedAccount",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "UUPSUnauthorizedCallContext",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "slot",
        "type": "bytes32"
      }
    ],
    "name": "UUPSUnsupportedProxiableUUID",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "approved",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "Approval",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "operator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "approved",
        "type": "bool"
      }
    ],
    "name": "ApprovalForAll",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_fromTokenId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_toTokenId",
        "type": "uint256"
      }
    ],
    "name": "BatchMetadataUpdate",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [],
    "name": "EIP712DomainChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "version",
        "type": "uint64"
      }
    ],
    "name": "Initialized",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "agentId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "string",
        "name": "indexedMetadataKey",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "metadataKey",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "metadataValue",
        "type": "bytes"
      }
    ],
    "name": "MetadataSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_tokenId",
        "type": "uint256"
      }
    ],
    "name": "MetadataUpdate",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "previousOwner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "OwnershipTransferred",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "agentId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "agentURI",
        "type": "string"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "Registered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "Transfer",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "agentId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "newURI",
        "type": "string"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "updatedBy",
        "type": "address"
      }
    ],
    "name": "URIUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "implementation",
        "type": "address"
      }
    ],
    "name": "Upgraded",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "UPGRADE_INTERFACE_VERSION",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "approve",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "eip712Domain",
    "outputs": [
      {
        "internalType": "bytes1",
        "name": "fields",
        "type": "bytes1"
      },
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "version",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "chainId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "verifyingContract",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "salt",
        "type": "bytes32"
      },
      {
        "internalType": "uint256[]",
        "name": "extensions",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "agentId",
        "type": "uint256"
      }
    ],
    "name": "getAgentWallet",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "getApproved",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "agentId",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "metadataKey",
        "type": "string"
      }
    ],
    "name": "getMetadata",
    "outputs": [
      {
        "internalType": "bytes",
        "name": "",
        "type": "bytes"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getVersion",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "initialize",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "operator",
        "type": "address"
      }
    ],
    "name": "isApprovedForAll",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "name",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "ownerOf",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "proxiableUUID",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "register",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "agentId",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "agentURI",
        "type": "string"
      },
      {
        "components": [
          {
            "internalType": "string",
            "name": "metadataKey",
            "type": "string"
          },
          {
            "internalType": "bytes",
            "name": "metadataValue",
            "type": "bytes"
          }
        ],
        "internalType": "struct IdentityRegistryUpgradeable.MetadataEntry[]",
        "name": "metadata",
        "type": "tuple[]"
      }
    ],
    "name": "register",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "agentId",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "agentURI",
        "type": "string"
      }
    ],
    "name": "register",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "agentId",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "renounceOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "safeTransferFrom",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "data",
        "type": "bytes"
      }
    ],
    "name": "safeTransferFrom",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "agentId",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "newURI",
        "type": "string"
      }
    ],
    "name": "setAgentURI",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "agentId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "newWallet",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "deadline",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "signature",
        "type": "bytes"
      }
    ],
    "name": "setAgentWallet",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "operator",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "approved",
        "type": "bool"
      }
    ],
    "name": "setApprovalForAll",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "agentId",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "metadataKey",
        "type": "string"
      },
      {
        "internalType": "bytes",
        "name": "metadataValue",
        "type": "bytes"
      }
    ],
    "name": "setMetadata",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes4",
        "name": "interfaceId",
        "type": "bytes4"
      }
    ],
    "name": "supportsInterface",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "symbol",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "tokenURI",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "transferFrom",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "agentId",
        "type": "uint256"
      }
    ],
    "name": "unsetAgentWallet",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newImplementation",
        "type": "address"
      },
      {
        "internalType": "bytes",
        "name": "data",
        "type": "bytes"
      }
    ],
    "name": "upgradeToAndCall",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assert(condition: boolean, msg: string): asserts condition {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

function log(msg: string) {
  console.log(`[e2e] ${msg}`);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Start a tiny HTTP server that serves `body` at /payload.
 * Returns the server and the URL.
 */
function servePayload(body: string): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const srv = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
    });
    srv.listen(PAYLOAD_PORT, () => {
      resolve({ server: srv, url: `http://localhost:${PAYLOAD_PORT}/payload` });
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  assert(!!PRIVATE_KEY, "PRIVATE_KEY env var is required");
  assert(!!VALIDATION_REGISTRY, "REGISTRY_ADDRESS env var is required");
  assert(!!ROUTER_ADDRESS, "ROUTER_ADDRESS env var is required");

  log(`RPC:                  ${RPC_URL}`);
  log(`ValidationRegistry:   ${VALIDATION_REGISTRY}`);
  log(`IdentityRegistry:     ${IDENTITY_REGISTRY}`);
  log(`Router (validator):   ${ROUTER_ADDRESS}`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  log(`Wallet:               ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  log(`Balance:              ${ethers.formatEther(balance)} ETH`);
  assert(balance > 0n, "Wallet has no Base Sepolia ETH — fund it first");

  // --- 1. Ensure we own an agent in the IdentityRegistry ---

  const identity = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_REGISTRY_ABI, wallet);
  let agentId: bigint;

  const agentCount = (await identity.balanceOf(wallet.address)) as bigint;
  if (agentCount > 0n) {
    log("Wallet already owns agent(s) — querying Registered events for the agentId…");

    const mkFilter = identity.filters["Registered"]!;
    const registeredFilter = mkFilter(null, null, wallet.address);
    const events = await identity.queryFilter(registeredFilter, 0);

    if (events.length > 0) {
      const evt = events[events.length - 1] as ethers.EventLog;
      agentId = evt.args[0] as bigint;
    } else {
      log("  No Registered events found — falling back to Transfer events (ERC-721 mint)…");
      const mkTransferFilter = identity.filters["Transfer"]!;
      const transferFilter = mkTransferFilter(ethers.ZeroAddress, wallet.address);
      const transfers = await identity.queryFilter(transferFilter, 0);
      assert(transfers.length > 0, "Could not find any mint Transfer events for wallet");
      const lastMint = transfers[transfers.length - 1] as ethers.EventLog;
      agentId = lastMint.args[2] as bigint;
    }
  } else {
    log("Registering a new agent in the IdentityRegistry…");
    const tx = await identity["register(string)"]("https://example.com/agent.json");
    const receipt = await tx.wait(1);
    log(`  register tx confirmed: ${tx.hash} (block ${receipt?.blockNumber})`);

    const parsed = receipt?.logs
      ?.map((l: ethers.Log) => {
        try { return identity.interface.parseLog(l); }
        catch { return null; }
      })
      .filter(Boolean) as ethers.LogDescription[];

    const regEvent = parsed.find((e) => e.name === "Registered");
    if (regEvent) {
      agentId = regEvent.args[0] as bigint;
    } else {
      const transferEvent = parsed.find((e) => e.name === "Transfer");
      assert(!!transferEvent, "Neither Registered nor Transfer event found in tx receipt");
      agentId = transferEvent!.args[2] as bigint;
    }
  }

  log(`Agent ID:             ${agentId}`);

  // --- 2. Build a signed test payload ---

  const now = new Date();
  const deadline = new Date(now.getTime() + 60 * 60 * 1000);
  const clientWallet = ethers.Wallet.createRandom();
  const serverWallet = ethers.Wallet.createRandom();

  const mandate = new CoreMandate({
    mandateId: `e2e-test-${Date.now()}`,
    version: "0.1.0",
    client: caip10(84532, clientWallet.address),
    server: caip10(84532, serverWallet.address),
    createdAt: now.toISOString(),
    deadline: deadline.toISOString(),
    intent: "E2E test: swap 100 USDC for WBTC on Base Sepolia",
    core: {
      kind: "swap@1",
      payload: {
        tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        tokenOut: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
        amountIn: "100000000",
        minOut: "165000",
        chainId: 84532,
      },
    },
    signatures: {},
  });

  await mandate.signAsServer(serverWallet, "eip191");
  await mandate.signAsClient(clientWallet, "eip191");

  const payload = {
    agentId: Number(agentId),
    mandate: mandate.toJSON(),
    receipt: {
      txHash: "0x" + "ab".repeat(32),
      chainId: 84532,
      executedAt: now.toISOString(),
    },
  };

  const payloadJson = JSON.stringify(payload);
  const payloadHash = ethers.sha256(new TextEncoder().encode(payloadJson));
  log(`Payload hash:         ${payloadHash}`);

  // --- 3. Serve the payload over HTTP ---

  const { server: payloadServer, url: requestURI } = await servePayload(payloadJson);
  log(`Payload server:       ${requestURI}`);

  // --- 4. Submit validationRequest on-chain ---

  const registry = new ethers.Contract(VALIDATION_REGISTRY!, VALIDATION_REGISTRY_ABI, wallet);

  log("Submitting validationRequest on-chain…");

  const gasEstimate = await registry.validationRequest!.estimateGas(
    ROUTER_ADDRESS,
    agentId,
    requestURI,
    payloadHash,
  );

  const tx = await registry.validationRequest!(
    ROUTER_ADDRESS,
    agentId,
    requestURI,
    payloadHash,
    { gasLimit: (gasEstimate * 150n) / 100n },
  );

  log(`  tx sent:            ${tx.hash}`);
  const txReceipt = await tx.wait(1);
  log(`  tx confirmed:       block ${txReceipt?.blockNumber}`);

  // --- 5. Poll for the router's response ---

  log("Waiting for the router to respond (polling every 10s, timeout 3 min)…");
  log("  Make sure the router is running: npm run dev");

  const TIMEOUT_MS = 3 * 60 * 1000;
  const POLL_INTERVAL = 10_000;
  const startTime = Date.now();

  let responded = false;

  const ZERO_BYTES32 = ethers.ZeroHash;

  while (Date.now() - startTime < TIMEOUT_MS) {
    try {
      const status = await registry.getValidationStatus(payloadHash);
      const responseHash = status[3] as string;
      // Contract sets lastUpdate on request; we have a response only when responseHash is set
      if (responseHash !== ZERO_BYTES32 && responseHash !== "0x" + "00".repeat(32)) {
        const response = status[2] as bigint;
        const tag = status[4] as string;
        const lastUpdate = status[5] as bigint;

        log("--- Router Response Detected ---");
        log(`  response (score):   ${response}`);
        log(`  responseHash:       ${responseHash}`);
        log(`  tag:                ${tag}`);
        log(`  lastUpdate:         ${lastUpdate} (block timestamp)`);
        responded = true;
        break;
      }
    } catch (err: unknown) {
      // getValidationStatus reverts with "unknown" when requestHash is not in the registry
      // (e.g. node lag, or different contract version). Treat as pending and keep polling.
      const msg = err instanceof Error ? err.message : String(err);
      if (!String(msg).includes("unknown") && !String(msg).includes("reverted")) {
        throw err;
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    process.stdout.write(`\r  waiting… ${elapsed}s elapsed`);
    await sleep(POLL_INTERVAL);
  }

  process.stdout.write("\n");

  payloadServer.close();

  if (responded) {
    log("PASS — end-to-end validation request/response on Base Sepolia succeeded.");
  } else {
    log("TIMEOUT — the router did not respond within 3 minutes.");
    log("  Ensure the router is running with the same REGISTRY_ADDRESS and ROUTER_ADDRESS.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
