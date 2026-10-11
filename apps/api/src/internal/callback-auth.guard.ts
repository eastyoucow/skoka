import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import {
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  verifyCallbackAuth,
} from './callback-auth';

@Injectable()
export class CallbackAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const secret = this.config.get<string>('callbackSharedSecret') ?? '';
    const maxSkewSeconds =
      this.config.get<number>('callbackMaxSkewSeconds') ?? 300;

    const rawBody = req.rawBody;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new UnauthorizedException('missing raw body for signature check');
    }

    const result = verifyCallbackAuth({
      secret,
      authorization: req.header('authorization') ?? undefined,
      timestamp: req.header(HEADER_TIMESTAMP) ?? undefined,
      signature: req.header(HEADER_SIGNATURE) ?? undefined,
      rawBody,
      maxSkewSeconds,
    });

    if (!result.ok) {
      throw new UnauthorizedException(result.reason);
    }
    return true;
  }
}
