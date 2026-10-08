import { SetMetadata } from '@nestjs/common';

export const HUMAN_ONLY_KEY = 'humanOnly';

/**
 * Marks a route as requiring an interactive session — API tokens (personal or
 * bot) are refused. Used for credential and account-security actions, so a
 * leaked token can't mint more tokens, change the password or touch 2FA.
 */
export const HumanOnly = () => SetMetadata(HUMAN_ONLY_KEY, true);
