import { Controller, Get, Param, Query } from '@nestjs/common';
import { SearchQueryInput, SearchQuerySchema } from '@backstages/shared';
import { SearchService } from './search.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('workspaces/:workspaceId/search')
  run(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Query(new ZodValidationPipe(SearchQuerySchema)) query: SearchQueryInput,
  ) {
    return this.search.search(user.id, workspaceId, query);
  }
}
