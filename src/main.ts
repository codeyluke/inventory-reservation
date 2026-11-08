import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks(); // stop the expiry sweeper cleanly on SIGTERM
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`Inventory reservation API listening on :${port}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error('Failed to start', error, 'Bootstrap');
  process.exit(1);
});
