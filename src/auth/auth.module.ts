import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AuthController, MeController } from './auth.controller';
import { AuthService } from './auth.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({
        secret: cfg.jwtAccessSecret,
        signOptions: { expiresIn: cfg.jwtAccessTtlSeconds },
      }),
    }),
  ],
  controllers: [AuthController, MeController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
