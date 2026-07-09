import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The authenticated principal attached to the request by JwtAuthGuard. */
export interface AuthUser {
  /** The user id (resolved from the JWT `sub` claim). */
  id: string;
  email: string;
}

/** Yields the AuthUser — `user.id` is always the user id, never the raw JWT payload. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
  return request.user;
});
