import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UsePipes,
  Logger,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { WebhookEndpointsService } from './webhook-endpoints.service';
import {
  CreateWebhookEndpointSchema,
  UpdateWebhookEndpointSchema,
  type CreateWebhookEndpointDto,
  type UpdateWebhookEndpointDto,
} from './dto/webhook-endpoint.dto';
import { getPrincipalContext } from '../../observability/request-context';

@Controller('webhooks/endpoints')
@RequirePermission('webhook:manage')
export class WebhookEndpointsController {
  private readonly logger = new Logger(WebhookEndpointsController.name);

  constructor(private readonly service: WebhookEndpointsService) {}

  private ctx() {
    const { tenantId, userId, traceId } = getPrincipalContext();
    return { tenantId, actorId: userId, traceId };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(CreateWebhookEndpointSchema))
  async create(@Body() dto: CreateWebhookEndpointDto) {
    const { tenantId, actorId, traceId } = this.ctx();
    const result = await this.service.create(tenantId, dto, actorId, traceId);
    return { data: result };
  }

  @Get()
  @RequirePermission('webhook:read', 'webhook:manage')
  async list(
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ) {
    const { tenantId } = this.ctx();
    const limit = limitStr ? Math.min(parseInt(limitStr, 10) || 50, 100) : 50;
    const result = await this.service.list(tenantId, limit, cursor);
    return result;
  }

  @Get(':id')
  @RequirePermission('webhook:read', 'webhook:manage')
  async getById(@Param('id') id: string) {
    const { tenantId } = this.ctx();
    const result = await this.service.getById(tenantId, id);
    return { data: result };
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(UpdateWebhookEndpointSchema))
  async update(@Param('id') id: string, @Body() dto: UpdateWebhookEndpointDto) {
    const { tenantId, actorId, traceId } = this.ctx();
    const result = await this.service.update(tenantId, id, dto, actorId, traceId);
    return { data: result };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    const { tenantId, actorId, traceId } = this.ctx();
    await this.service.delete(tenantId, id, actorId, traceId);
  }

  @Post(':id/rotate-secret')
  async rotateSecret(@Param('id') id: string) {
    const { tenantId, actorId, traceId } = this.ctx();
    const result = await this.service.rotateSecret(tenantId, id, actorId, traceId);
    return { data: result };
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  async disable(@Param('id') id: string) {
    const { tenantId, actorId, traceId } = this.ctx();
    await this.service.disable(tenantId, id, actorId, traceId);
    return { data: { status: 'disabled' } };
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  async enable(@Param('id') id: string) {
    const { tenantId, actorId, traceId } = this.ctx();
    await this.service.enable(tenantId, id, actorId, traceId);
    return { data: { status: 'active' } };
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  async testFire(@Param('id') id: string) {
    const { tenantId, actorId, traceId } = this.ctx();
    const result = await this.service.testFire(tenantId, id, actorId, traceId);
    return { data: result };
  }
}
