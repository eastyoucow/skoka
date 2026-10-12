import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { WebSession } from './entities/web-session.entity';
import { WebSessionService } from './web-session.service';

export type AuthedWebRequest = Request & { webSession: WebSession };

@Injectable()
export class WebAuthGuard implements CanActivate {
  constructor(private readonly sessions: WebSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedWebRequest>();
    const header = req.headers.authorization;
    if (!header || typeof header !== 'string') {
      throw new UnauthorizedException('Missing Authorization header');
    }
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Expected Bearer token');
    }

    const session = await this.sessions.findValidByToken(token);
    if (!session) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    void this.sessions.touch(session.id);
    req.webSession = session;
    return true;
  }
}
