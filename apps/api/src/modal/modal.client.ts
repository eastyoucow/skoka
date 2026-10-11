import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModalClient } from 'modal';

export interface ModalJobPayload {
  jobId: string;
  attemptId: string;
  inputKey: string;
  prompt: string;
  outputKey: string;
  callbackUrl: string;
}

export interface ModalSpawnResult {
  callId: string;
}

/**
 * Thin wrapper around Modal JS SDK.
 * Invokes deployed Python function skoka-inference / run_job via spawn.
 */
@Injectable()
export class ModalInferenceClient implements OnModuleInit {
  private readonly logger = new Logger(ModalInferenceClient.name);
  private client: ModalClient | null = null;
  private appName = 'skoka-inference';
  private functionName = 'run_job';
  private ready = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.appName = this.config.get<string>('modal.appName') ?? 'skoka-inference';
    this.functionName =
      this.config.get<string>('modal.functionName') ?? 'run_job';

    const tokenId = this.config.get<string>('modal.tokenId') ?? '';
    const tokenSecret = this.config.get<string>('modal.tokenSecret') ?? '';

    try {
      // Prefer explicit env tokens (Docker/Render); otherwise SDK reads ~/.modal.toml.
      this.client =
        tokenId && tokenSecret
          ? new ModalClient({ tokenId, tokenSecret })
          : new ModalClient();
      this.ready = true;
    } catch (err) {
      this.logger.warn(
        `Modal client not initialized: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.ready = false;
    }
  }

  isConfigured(): boolean {
    return this.ready && this.client !== null;
  }

  async spawn(payload: ModalJobPayload): Promise<ModalSpawnResult> {
    if (!this.client) {
      throw new Error('Modal client is not configured');
    }

    const fn = await this.client.functions.fromName(
      this.appName,
      this.functionName,
    );
    // Python signature: run_job(payload: dict) — single positional arg.
    const call = await fn.spawn([payload]);
    const callId = call.functionCallId;
    this.logger.log(
      JSON.stringify({
        msg: 'modal_spawned',
        jobId: payload.jobId,
        attemptId: payload.attemptId,
        modalCallId: callId,
      }),
    );
    return { callId };
  }
}
