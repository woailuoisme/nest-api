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
  exports: [
    JwtSecretCommand,
    RouteListCommand,
    DbSeedCommand,
    AppInitCommand,
    CrudGenerateCommand,
    SearchImportCommand,
    SearchFlushCommand,
    SearchSyncSettingsCommand,
  ],
})
export class CommandsModule {}
