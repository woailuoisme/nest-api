import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DbSeedCommand } from './db-seed.command';
import { CrudGenerateCommand } from './generator/crud-generate.command';
import { CrudGeneratorService } from './generator/crud-generator.service';
import { JwtSecretCommand } from './jwt-secret.command';
import { RouteListCommand } from './route-list.command';

@Module({
  imports: [DiscoveryModule],
  providers: [JwtSecretCommand, RouteListCommand, DbSeedCommand, CrudGenerateCommand, CrudGeneratorService],
  exports: [JwtSecretCommand, RouteListCommand, DbSeedCommand, CrudGenerateCommand],
})
export class CommandsModule {}
