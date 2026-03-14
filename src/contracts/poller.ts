import { ethers } from "ethers";
import type { EventLog } from "ethers";

import { getRegistryContract } from "./ValidationRegistry.js";
import { logger } from "../router/logger.js";

export interface PendingValidationRequest {
  requestHash: string;
  requestURI: string;
  agentId: bigint;
}

type RequestHandler = (req: PendingValidationRequest) => void;

const CATCHUP_LOOKBACK_BLOCKS = 50_000;

/**
 * Polls the ERC-8004 ValidationRegistry for new ValidationRequest events
 * targeted at a specific validator (router) address.
 *
 * On startup it scans the last ~50 000 blocks to pick up any pending requests
 * that arrived while the router was offline.  After that it polls every
 * `intervalMs` for newly emitted events.
 */
export class ValidationPoller {
  private readonly registry: ethers.Contract;
  private readonly provider: ethers.JsonRpcProvider;
  private readonly routerAddress: string;
  private readonly seen = new Set<string>();
  private lastBlock = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private handler: RequestHandler = () => {};

  constructor(
    provider: ethers.JsonRpcProvider,
    registryAddress: string,
    routerAddress: string,
  ) {
    this.provider = provider;
    this.registry = getRegistryContract(registryAddress, provider);
    this.routerAddress = routerAddress;
  }

  onRequest(handler: RequestHandler): void {
    this.handler = handler;
  }

  async start(intervalMs: number = 15_000): Promise<void> {
    await this.catchUp();
    this.timer = setInterval(() => void this.poll(), intervalMs);
    logger.info(
      { intervalMs, startBlock: this.lastBlock, router: this.routerAddress },
      "Validation poller started",
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info("Validation poller stopped");
    }
  }

  /**
   * Scan recent history for any ValidationRequest events targeting this
   * router that haven't been responded to yet.
   */
  private async catchUp(): Promise<void> {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - CATCHUP_LOOKBACK_BLOCKS);

      const mkFilter = this.registry.filters["ValidationRequest"]!;
      const filter = mkFilter(this.routerAddress);
      const events = await this.registry.queryFilter(filter, fromBlock, currentBlock);

      let pending = 0;
      for (const event of events) {
        if (!(event instanceof ethers.EventLog)) continue;

        const requestHash = event.args[3] as string;
        if (this.seen.has(requestHash)) continue;

        const status = await this.registry["getValidationStatus"]!(requestHash);
        const lastUpdate = status[5] as bigint;
        if (lastUpdate !== 0n) {
          this.seen.add(requestHash);
          continue;
        }

        this.seen.add(requestHash);
        pending++;
        this.handler({
          requestHash,
          requestURI: event.args[2] as string,
          agentId: event.args[1] as bigint,
        });
      }

      this.lastBlock = currentBlock;
      logger.info(
        { scannedBlocks: currentBlock - fromBlock, pendingFound: pending },
        "Catch-up complete",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ error: msg }, "Catch-up scan failed");
      this.lastBlock = await this.provider.getBlockNumber().catch(() => 0);
    }
  }

  /** Poll for new events since the last processed block. */
  private async poll(): Promise<void> {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      if (currentBlock <= this.lastBlock) return;

      const mkFilter = this.registry.filters["ValidationRequest"]!;
      const filter = mkFilter(this.routerAddress);
      const events = await this.registry.queryFilter(
        filter,
        this.lastBlock + 1,
        currentBlock,
      );

      for (const event of events) {
        if (!(event instanceof ethers.EventLog)) continue;

        const requestHash = event.args[3] as string;
        if (this.seen.has(requestHash)) continue;
        this.seen.add(requestHash);

        logger.info(
          { requestHash, block: event.blockNumber },
          "New validation request detected on-chain",
        );

        this.handler({
          requestHash,
          requestURI: event.args[2] as string,
          agentId: event.args[1] as bigint,
        });
      }

      this.lastBlock = currentBlock;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ error: msg }, "Poll cycle failed");
    }
  }
}
