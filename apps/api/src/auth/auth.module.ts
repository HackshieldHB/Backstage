import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: process.env.JWT_ACCESS_SECRET,
        signOptions: { expiresIn: process.env.JWT_ACCESS_TTL ?? '15m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [TokenService, AuthService],
})
export class AuthModule {}
