import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { AppInitCommand } from './app-init.command';
import { DbSeedCommand } from './db-seed.command';
import { CrudGenerateCommand } from './generator/crud-generate.command';
import { CrudGeneratorService } from './generator/crud-generator.service';
import { JwtSecretCommand } from './jwt-secret.command';
import { RouteListCommand } from './route-list.command';
import { SearchFlushCommand, SearchImportCommand, SearchSyncSettingsCommand } from './search.command';

@Module({
  imports: [DiscoveryModule],
  // nest-commander 通过 DiscoveryModule 发现全部 @Command 提供者，命令类无需导出给任何消费方
  providers: [
    JwtSecretCommand,
    RouteListCommand,
    DbSeedCommand,
    AppInitCommand,
    CrudGenerateCommand,
    CrudGeneratorService,
    SearchImportCommand,
    SearchFlushCommand,
    SearchSyncSettingsCommand,
  ],
})
export class CommandsModule {}
