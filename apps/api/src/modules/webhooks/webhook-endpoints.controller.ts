import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodError } from 'zod';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { Permission } from '../../common/auth/permissions';
import type { PrincipalContext } from '../../observability/request-context';
import { WebhookEndpointsService } from './webhook-endpoints.service';
import {
  CreateWebhookEndpointDto,
  ListWebhookEndpointsQuery,
  UpdateWebhookEndpointDto,
} from './dto/webhook-endpoint.dto';

type AuthRequest = Request & { user?: PrincipalContext };

@Controller('api/v1/webhooks/endpoints')
export class WebhookEndpointsController {
  constructor(private readonly service: WebhookEndpointsService) {}

  @Post()
  @RequirePermission(Permission.WEBHOOKS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() rawBody: unknown, @Req() req: AuthRequest) {
    const principal = getPrincipal(req);
    const dto = parseBody(CreateWebhookEndpointDto, rawBody);
    const result = await this.service.create(dto, principal);
    return { data: result };
  }

  @Get()
  @RequirePermission(Permission.WEBHOOKS_MANAGE)
  async list(@Query() rawQuery: unknown, @Req() req: AuthRequest) {
    const principal = getPrincipal(req);
    const query = parseBody(ListWebhookEndpointsQuery, rawQuery);
    return this.service.list(query, principal);
  }

  @Get(':id')
  @RequirePermission(Permission.WEBHOOKS_MANAGE)
  async getOne(@Param('id') id: string, @Req() req: AuthRequest) {
    const principal = getPrincipal(req);
    const result = await this.service.getOne(id, principal);
    return { data: result };
  }

  @Patch(':id')
  @RequirePermission(Permission.WEBHOOKS_MANAGE)
  async update(@Param('id') id: string, @Body() rawBody: unknown, @Req() req: AuthRequest) {
    const principal = getPrincipal(req);
    const dto = parseBody(UpdateWebhookEndpointDto, rawBody);
    const result = await this.service.update(id, dto, principal);
    return { data: result };
  }

  @Delete(':id')
  @RequirePermission(Permission.WEBHOOKS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @Req() req: AuthRequest) {
    const principal = getPrincipal(req);
    await this.service.delete(id, principal);
  }

  @Post(':id/rotate-secret')
  @RequirePermission(Permission.WEBHOOKS_MANAGE)
  async rotateSecret(@Param('id') id: string, @Req() req: AuthRequest) {
    const principal = getPrincipal(req);
    const result = await this.service.rotateSecret(id, principal);
    return { data: result };
  }

  @Post(':id/disable')
  @RequirePermission(Permission.WEBHOOKS_MANAGE)
  async disable(@Param('id') id: string, @Req() req: AuthRequest) {
    const principal = getPrincipal(req);
    const result = await this.service.disable(id, principal);
    return { data: result };
  }

  @Post(':id/enable')
  @RequirePermission(Permission.WEBHOOKS_MANAGE)
  async enable(@Param('id') id: string, @Req() req: AuthRequest) {
    const principal = getPrincipal(req);
    const result = await this.service.enable(id, principal);
    return { data: result };
  }

  @Post(':id/test')
  @RequirePermission(Permission.WEBHOOKS_MANAGE)
  async testFire(@Param('id') id: string, @Req() req: AuthRequest) {
    const principal = getPrincipal(req);
    const result = await this.service.testFire(id, principal);
    return { data: result };
  }
}

function getPrincipal(req: AuthRequest): PrincipalContext {
  if (!req.user) throw new NotFoundException({ code: 'UNAUTHENTICATED' });
  return req.user;
}

function parseBody<T>(schema: { parse(v: unknown): T }, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new UnprocessableEntityException({
        code: 'SCHEMA_VIOLATION',
        message: 'Request body did not match the expected schema.',
        details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
      });
    }
    throw err;
  }
}
