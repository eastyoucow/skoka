import { UnauthorizedException } from '@nestjs/common';
import { WebAuthGuard } from './web-auth.guard';
import { WebSession } from './entities/web-session.entity';
import { WebSessionService } from './web-session.service';

describe('WebAuthGuard', () => {
  const sessions = {
    findValidByToken: jest.fn(),
    touch: jest.fn(),
  };
  const guard = new WebAuthGuard(sessions as unknown as WebSessionService);

  function ctx(authorization?: string) {
    const req: { headers: Record<string, string | undefined>; webSession?: WebSession } = {
      headers: { authorization },
    };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
      req,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects missing Authorization', async () => {
    await expect(guard.canActivate(ctx() as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects invalid scheme', async () => {
    await expect(
      guard.canActivate(ctx('Basic abc') as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches session for valid Bearer token', async () => {
    const session = {
      id: 's1',
      expiresAt: new Date(Date.now() + 60_000),
    } as WebSession;
    sessions.findValidByToken.mockResolvedValue(session);
    const c = ctx('Bearer good-token');
    await expect(guard.canActivate(c as never)).resolves.toBe(true);
    expect(c.req.webSession).toBe(session);
    expect(sessions.touch).toHaveBeenCalledWith('s1');
  });
});
