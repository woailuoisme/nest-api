import 'dotenv/config';
// 必须早于其余 import：ESM import 会被提升，只有最先被导入的模块才能保证 SDK 最早初始化
import './setup/otel/telemetry';
import { startServer } from './bootstrap/server';

void startServer();
