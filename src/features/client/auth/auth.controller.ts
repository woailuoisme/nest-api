import { All, Controller, Req, Res } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '@/common/decorators/public.decorator';
import { AuthService } from './auth.service';

@ApiExcludeController()
@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @All('*')
  @ApiOperation({ summary: 'Better Auth 统一认证分发端点' })
  async handleAuth(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const protocol = request.protocol || 'http';
    const host = request.headers.host || 'localhost:4300';
    const rawUrl = request.raw.url || request.url;
    const url = new URL(rawUrl, `${protocol}://${host}`);

    const headers = fromNodeHeaders(request.headers);
    const body = request.body ? JSON.stringify(request.body) : undefined;

    const webReq = new Request(url.toString(), {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : body,
    });

    const response = await this.authService.auth.handler(webReq);
    await this.authService.pipeResponse(response, reply);
  }
}
