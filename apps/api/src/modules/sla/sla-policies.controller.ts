import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { SlaPoliciesService } from './sla-policies.service';
import {
  CreatePolicySchema,
  UpdatePolicySchema,
  ListQuerySchema,
  type CreatePolicyDto,
  type UpdatePolicyDto,
  type ListQueryDto,
} from './dto/sla.dto';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { Permission } from '../../common/auth/permissions';

function parseBody<T>(schema: { parse(v: unknown): T }, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new UnprocessableEntityException({
        code: 'SCHEMA_VIOLATION',
        message: 'Request body did not match the expected schema.',
        details: err.errors.map((e) => ({ field: e.path.join('.'), issue: e.message })),
      });
    }
    throw err;
  }
}

@Controller('api/v1/sla-policies')
export class SlaPoliciesController {
  constructor(private readonly service: SlaPoliciesService) {}

  @Get()
  @RequirePermission(Permission.SLA_POLICY_READ)
  async listPolicies(@Query() rawQuery: unknown) {
    const query = parseBody(ListQuerySchema, rawQuery) as ListQueryDto;
    return this.service.listPolicies(query);
  }

  @Get(':id')
  @RequirePermission(Permission.SLA_POLICY_READ)
  async getPolicy(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.getPolicy(id);
  }

  @Post()
  @RequirePermission(Permission.SLA_POLICY_WRITE)
  @HttpCode(HttpStatus.CREATED)
  async createPolicy(@Body() rawBody: unknown) {
    const dto = parseBody(CreatePolicySchema, rawBody) as CreatePolicyDto;
    return this.service.createPolicy(dto);
  }

  @Put(':id')
  @RequirePermission(Permission.SLA_POLICY_WRITE)
  async updatePolicy(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() rawBody: unknown,
  ) {
    const dto = parseBody(UpdatePolicySchema, rawBody) as UpdatePolicyDto;
    return this.service.updatePolicy(id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermission(Permission.SLA_POLICY_WRITE)
  async deactivatePolicy(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.deactivatePolicy(id);
  }
}
