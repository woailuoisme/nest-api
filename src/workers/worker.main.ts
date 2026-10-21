import 'dotenv/config';
import '@/setup/otel/telemetry';
import { startWorker } from '@/bootstrap/worker';

void startWorker();
