import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { SlaCalendarsService } from './sla-calendars.service';
import {
  CreateCalendarSchema,
  UpdateCalendarSchema,
  ListQuerySchema,
  type CreateCalendarDto,
  type UpdateCalendarDto,
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

@Controller('api/v1/sla-calendars')
export class SlaCalendarsController {
  constructor(private readonly service: SlaCalendarsService) {}

  @Get()
  @RequirePermission(Permission.SLA_POLICY_READ)
  async listCalendars(@Query() rawQuery: unknown) {
    const query = parseBody(ListQuerySchema, rawQuery) as ListQueryDto;
    return this.service.listCalendars(query);
  }

  @Get(':id')
  @RequirePermission(Permission.SLA_POLICY_READ)
  async getCalendar(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.getCalendar(id);
  }

  @Post()
  @RequirePermission(Permission.SLA_POLICY_WRITE)
  @HttpCode(HttpStatus.CREATED)
  async createCalendar(@Body() rawBody: unknown) {
    const dto = parseBody(CreateCalendarSchema, rawBody) as CreateCalendarDto;
    return this.service.createCalendar(dto);
  }

  @Put(':id')
  @RequirePermission(Permission.SLA_POLICY_WRITE)
  async updateCalendar(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() rawBody: unknown,
  ) {
    const dto = parseBody(UpdateCalendarSchema, rawBody) as UpdateCalendarDto;
    return this.service.updateCalendar(id, dto);
  }

  @Delete(':id')
  @RequirePermission(Permission.SLA_POLICY_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCalendar(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.service.deleteCalendar(id);
  }
}
