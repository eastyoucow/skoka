import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramFile } from './telegram.types';

@Injectable()
export class TelegramClient implements OnModuleInit {
  private readonly logger = new Logger(TelegramClient.name);
  private botToken = '';
  private apiBase = '';

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.botToken = this.config.get<string>('telegram.botToken') ?? '';
    this.apiBase = this.botToken
      ? `https://api.telegram.org/bot${this.botToken}`
      : '';
  }

  isConfigured(): boolean {
    return Boolean(this.botToken);
  }

  async getFile(fileId: string): Promise<TelegramFile> {
    const data = await this.callApi<{ result: TelegramFile }>('getFile', {
      file_id: fileId,
    });
    return data.result;
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    if (!this.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }
    const url = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Telegram file download failed: HTTP ${res.status}`);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  async sendMessage(chatId: number | string, text: string): Promise<void> {
    try {
      await this.callApi('sendMessage', {
        chat_id: chatId,
        text,
      });
    } catch (err) {
      this.logger.warn(
        JSON.stringify({
          msg: 'telegram_send_message_failed',
          chatId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  private async callApi<T = unknown>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    if (!this.apiBase) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }
    const res = await fetch(`${this.apiBase}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      ok: boolean;
      description?: string;
      result?: unknown;
    };
    if (!res.ok || !json.ok) {
      throw new Error(
        `Telegram API ${method} failed: ${json.description ?? res.status}`,
      );
    }
    return json as T;
  }
}
