import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CreateUploadDto } from './dto/create-upload.dto';
import { CreateWebJobDto } from './dto/create-web-job.dto';
import { AuthedWebRequest, WebAuthGuard } from './web-auth.guard';
import {
  WebJobsRateLimitGuard,
  WebSessionsRateLimitGuard,
  WebUploadsRateLimitGuard,
} from './web-rate-limits';
import { WebSessionService } from './web-session.service';
import { WebService } from './web.service';

@Controller('web')
export class WebController {
  constructor(
    private readonly sessions: WebSessionService,
    private readonly web: WebService,
  ) {}

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(WebSessionsRateLimitGuard)
  async createSession() {
    const { token, expiresAt } = await this.sessions.create();
    return { token, expiresAt };
  }

  @Post('uploads')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(WebAuthGuard, WebUploadsRateLimitGuard)
  async createUpload(
    @Req() req: AuthedWebRequest,
    @Body() dto: CreateUploadDto,
  ) {
    return this.web.createUpload(
      req.webSession,
      dto.contentType,
      dto.contentLength,
    );
  }

  @Post('jobs')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(WebAuthGuard, WebJobsRateLimitGuard)
  async createJob(
    @Req() req: AuthedWebRequest,
    @Body() dto: CreateWebJobDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    // Future: optional Cloudflare Turnstile token verification here.
    const { job, created } = await this.web.createJob(
      req.webSession,
      dto.uploadId,
      dto.prompt,
      idempotencyKey ?? '',
    );
    return this.web.toPublicJob(job, created);
  }

  @Get('jobs/:id')
  @UseGuards(WebAuthGuard)
  async getJob(
    @Req() req: AuthedWebRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const job = await this.web.getJobForSession(req.webSession, id);
    return this.web.toPublicJob(job);
  }

  @Get('jobs/:id/result')
  @UseGuards(WebAuthGuard)
  async getResult(
    @Req() req: AuthedWebRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.web.getResultUrls(req.webSession, id);
  }
}
