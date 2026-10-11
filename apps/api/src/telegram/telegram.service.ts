import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeliveryChannel,
  JobSource,
} from '../jobs/entities/job-status';
import { JobsService } from '../jobs/jobs.service';
import { TelegramClient } from './telegram.client';
import { TelegramMessage, TelegramUpdate } from './telegram.types';

const HELP_TEXT =
  'Send a photo to count objects. Optional caption is the label (default: person). Example caption: cat';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private readonly telegram: TelegramClient,
    private readonly jobs: JobsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Handle one Telegram update. Always safe to call twice (idempotent on update_id).
   * Returns quickly after queuing; does not wait for Modal.
   */
  async handleUpdate(update: TelegramUpdate): Promise<{ ok: true }> {
    const message = update.message;
    if (!message) {
      return { ok: true };
    }

    const chatId = message.chat.id;
    const text = (message.text ?? '').trim();

    if (text === '/start' || text === '/help') {
      await this.telegram.sendMessage(chatId, HELP_TEXT);
      return { ok: true };
    }

    const photo = pickLargestPhoto(message);
    if (!photo) {
      // Ignore non-photo chatter without spamming; hint on plain text.
      if (text) {
        await this.telegram.sendMessage(chatId, HELP_TEXT);
      }
      return { ok: true };
    }

    const defaultPrompt =
      this.config.get<string>('telegram.defaultPrompt') ?? 'person';
    const prompt = normalizePrompt(message.caption, defaultPrompt);

    try {
      const file = await this.telegram.getFile(photo.file_id);
      if (!file.file_path) {
        await this.telegram.sendMessage(
          chatId,
          'Could not download that photo. Please try again.',
        );
        return { ok: true };
      }

      const buffer = await this.telegram.downloadFile(file.file_path);
      const mimeType = mimeFromPath(file.file_path);

      const { job, created } = await this.jobs.createWithImageBuffer({
        source: JobSource.TELEGRAM,
        externalRequestId: String(update.update_id),
        prompt,
        channel: DeliveryChannel.TELEGRAM,
        recipientId: String(chatId),
        buffer,
        mimeType,
        originalName: file.file_path.split('/').pop() ?? 'photo.jpg',
      });

      this.logger.log(
        JSON.stringify({
          msg: created ? 'telegram_job_created' : 'telegram_job_idempotent',
          jobId: job.id,
          updateId: update.update_id,
          chatId,
          prompt,
          status: job.status,
        }),
      );

      if (created) {
        await this.telegram.sendMessage(
          chatId,
          `Got it — counting “${prompt}”. I will send the result when ready.`,
        );
      }
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          msg: 'telegram_handle_failed',
          updateId: update.update_id,
          chatId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      await this.telegram.sendMessage(
        chatId,
        'Sorry, I could not process that photo. Please try a JPEG/PNG/WebP under 10 MB.',
      );
    }

    return { ok: true };
  }
}

function pickLargestPhoto(
  message: TelegramMessage,
): { file_id: string } | null {
  if (message.photo?.length) {
    return message.photo[message.photo.length - 1];
  }
  // Allow image documents (e.g. uncompressed uploads).
  const doc = message.document;
  if (doc?.mime_type?.startsWith('image/')) {
    return { file_id: doc.file_id };
  }
  return null;
}

export function normalizePrompt(
  caption: string | undefined,
  defaultPrompt: string,
): string {
  const raw = (caption ?? '').trim();
  if (!raw) {
    return defaultPrompt;
  }
  // Strip leading slash commands like /count cat
  const withoutCmd = raw.replace(/^\/\w+\s+/, '').trim();
  const cleaned = withoutCmd.slice(0, 64);
  return cleaned || defaultPrompt;
}

function mimeFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}
