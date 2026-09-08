import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ZodExceptionFilter } from './common/zod-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalFilters(new ZodExceptionFilter());
  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
