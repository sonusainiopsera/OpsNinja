import { Module } from '@nestjs/common';

import { UsersController } from './users.controller';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [OrganizationsModule],
  controllers: [UsersController],
})
export class UsersModule {}
