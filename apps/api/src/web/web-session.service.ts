import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebSession } from './entities/web-session.entity';
import { generateSessionToken, hashSessionToken } from './web-token.util';

@Injectable()
export class WebSessionService {
  constructor(
    @InjectRepository(WebSession)
    private readonly sessions: Repository<WebSession>,
    private readonly config: ConfigService,
  ) {}

  async create(): Promise<{ token: string; expiresAt: Date; session: WebSession }> {
    const ttlHours = this.config.get<number>('web.sessionTtlHours') ?? 24;
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    const now = new Date();
    const session = this.sessions.create({
      tokenHash: hashSessionToken(token),
      expiresAt,
      lastSeenAt: now,
    });
    const saved = await this.sessions.save(session);
    return { token, expiresAt, session: saved };
  }

  async findValidByToken(token: string): Promise<WebSession | null> {
    const tokenHash = hashSessionToken(token);
    const session = await this.sessions.findOne({ where: { tokenHash } });
    if (!session) {
      return null;
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return session;
  }

  async touch(sessionId: string): Promise<void> {
    await this.sessions.update(
      { id: sessionId },
      { lastSeenAt: new Date() },
    );
  }
}
