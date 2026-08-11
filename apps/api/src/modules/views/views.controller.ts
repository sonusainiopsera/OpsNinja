import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { ViewsService } from './views.service';
import {
  CreateViewSchema,
  PatchViewSchema,
  ReorderPinsSchema,
  type CreateViewDto,
  type PatchViewDto,
  type ReorderPinsDto,
} from './dto/save-view.dto';
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
        details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
      });
    }
    throw err;
  }
}

@Controller('api/v1/views')
@RequirePermission(Permission.TICKETS_READ)
export class ViewsController {
  constructor(private readonly viewsService: ViewsService) {}

  @Get()
  async listViews() {
    return this.viewsService.listViews();
  }

  @Get(':id')
  async getView(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.viewsService.getView(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createView(@Body() rawBody: unknown) {
    const dto = parseBody(CreateViewSchema, rawBody);
    return this.viewsService.createView(dto);
  }

  @Patch(':id')
  async patchView(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() rawBody: unknown,
  ) {
    const dto = parseBody(PatchViewSchema, rawBody);
    return this.viewsService.patchView(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteView(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.viewsService.deleteView(id);
  }

  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  async duplicateView(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.viewsService.duplicateView(id);
  }

  // PUT pins/order must be declared BEFORE :id/pin to avoid route shadowing
  @Put('pins/order')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reorderPins(@Body() rawBody: unknown) {
    const dto = parseBody(ReorderPinsSchema, rawBody);
    await this.viewsService.reorderPins(dto.view_ids);
  }

  @Put(':id/pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async pinView(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.viewsService.pinView(id);
  }

  @Delete(':id/pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unpinView(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.viewsService.unpinView(id);
  }
}
