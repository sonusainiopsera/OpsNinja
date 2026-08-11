/**
 * ViewsController — WO-039 + WO-040.
 *
 * REST surface for saved views: list, create, update, delete, duplicate,
 * pin/unpin, and batch reorder pins.
 * Also serves GET /api/v1/views/counts (WO-040) for the views rail badges.
 *
 * Endpoint map:
 *   GET    /api/v1/views
 *   GET    /api/v1/views/counts        ← WO-040
 *   POST   /api/v1/views
 *   GET    /api/v1/views/:id
 *   PATCH  /api/v1/views/:id
 *   DELETE /api/v1/views/:id
 *   POST   /api/v1/views/:id/duplicate
 *   PUT    /api/v1/views/:id/pin
 *   DELETE /api/v1/views/:id/pin
 *   PUT    /api/v1/views/pins/order
 *
 * NOTE: /counts and /pins/order must be declared BEFORE /:id routes to avoid
 * being captured by the /:id pattern. NestJS uses declaration order for matching.
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { ViewsService } from './views.service';
import { ViewCountsService } from './view-counts.service';
import {
  CreateViewSchema,
  UpdateViewSchema,
  ReorderPinsSchema,
  type CreateViewDto,
  type UpdateViewDto,
  type ReorderPinsDto,
} from './dto/save-view.dto';
import { getPrincipalContext } from '../../observability/request-context';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller('views')
export class ViewsController {
  constructor(
    private readonly service: ViewsService,
    private readonly viewCountsService: ViewCountsService,
  ) {}

  private ctx() {
    return getPrincipalContext();
  }

  private hasSharePermission(): boolean {
    const { roles } = this.ctx();
    // view:share is granted to admin and manager roles (see permission.catalog.ts).
    return roles.some((r) => ['admin', 'manager'].includes(r));
  }

  // --------------------------------------------------------------------------
  // List — system + shared + own private views, each with pin state
  // --------------------------------------------------------------------------

  @Get()
  @RequirePermission('view:read')
  async list() {
    const principal = this.ctx();
    const views = await this.service.listForPrincipal(principal);
    return { data: views };
  }

  // --------------------------------------------------------------------------
  // Counts — per-view ticket counts for the views rail (WO-040)
  // NOTE: must be declared BEFORE ':id' route to avoid pattern capture.
  // --------------------------------------------------------------------------

  @Get('counts')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('view:read')
  async getCounts() {
    const principal = this.ctx();
    const counts = await this.viewCountsService.getCounts(principal);
    return { counts };
  }

  // --------------------------------------------------------------------------
  // Get single view
  // --------------------------------------------------------------------------

  @Get(':id')
  @RequirePermission('view:read')
  async getById(@Param('id') id: string) {
    const principal = this.ctx();
    const view = await this.service.getById(principal, id);
    return { data: view };
  }

  // --------------------------------------------------------------------------
  // Create custom view
  // --------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('view:create')
  async create(@Body(new ZodValidationPipe(CreateViewSchema)) dto: CreateViewDto) {
    const principal = this.ctx();
    const view = await this.service.createView(principal, dto, this.hasSharePermission());
    return { data: view };
  }

  // --------------------------------------------------------------------------
  // Update view (PATCH)
  // --------------------------------------------------------------------------

  @Patch(':id')
  @RequirePermission('view:update')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateViewSchema)) dto: UpdateViewDto,
  ) {
    const principal = this.ctx();
    const view = await this.service.updateView(principal, id, dto, this.hasSharePermission());
    return { data: view };
  }

  // --------------------------------------------------------------------------
  // Delete view
  // --------------------------------------------------------------------------

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('view:delete')
  async remove(@Param('id') id: string) {
    const principal = this.ctx();
    await this.service.deleteView(principal, id, this.hasSharePermission());
  }

  // --------------------------------------------------------------------------
  // Duplicate (creates an editable private copy)
  // --------------------------------------------------------------------------

  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('view:create')
  async duplicate(@Param('id') id: string) {
    const principal = this.ctx();
    const view = await this.service.duplicateView(principal, id);
    return { data: view };
  }

  // --------------------------------------------------------------------------
  // Pin management
  // --------------------------------------------------------------------------

  @Put(':id/pin')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('view:read')
  async pin(@Param('id') id: string) {
    const principal = this.ctx();
    await this.service.pinView(principal, id);
    return { data: { pinned: true } };
  }

  @Delete(':id/pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('view:read')
  async unpin(@Param('id') id: string) {
    const principal = this.ctx();
    await this.service.unpinView(principal, id);
  }

  // --------------------------------------------------------------------------
  // Batch reorder pins
  // NOTE: this route must be declared BEFORE ':id' routes to avoid being
  // captured by the ':id' pattern. NestJS uses declaration order for matching.
  // --------------------------------------------------------------------------

  @Put('pins/order')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('view:read')
  async reorderPins(
    @Body(new ZodValidationPipe(ReorderPinsSchema)) dto: ReorderPinsDto,
  ) {
    const principal = this.ctx();
    await this.service.reorderPins(principal, dto.view_ids);
    return { data: { reordered: true } };
  }
}
