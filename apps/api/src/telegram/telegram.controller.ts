import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { SimpleRateLimitGuard } from '../common/simple-rate-limit.guard';
import { TelegramService } from './telegram.service';
import { TelegramUpdate } from './telegram.types';

@Controller('webhooks/telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private readonly telegramService: TelegramService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @UseGuards(SimpleRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async handle(
    @Req() req: Request,
    @Headers('x-telegram-bot-api-secret-token') secretHeader?: string,
  ) {
    const expected = this.config.get<string>('telegram.webhookSecret') ?? '';
    if (!expected) {
      this.logger.error('TELEGRAM_WEBHOOK_SECRET is not configured');
      throw new UnauthorizedException('webhook not configured');
    }
    if (!safeEqual(secretHeader ?? '', expected)) {
      throw new UnauthorizedException('invalid webhook secret');
    }

    const update = req.body as TelegramUpdate;
    if (!update || typeof update.update_id !== 'number') {
      // Acknowledge malformed quietly — avoid Telegram retry storms.
      return { ok: true };
    }

    // Process inline; download+R2 is usually seconds. Inference is async via dispatcher.
    await this.telegramService.handleUpdate(update);
    return { ok: true };
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}
