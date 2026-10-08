/** Live Atlassian numbers for the Applications Hub (read with the workspace connection). */
export type AtlassianOverviewDto =
  | { connected: false }
  | {
      connected: true;
      siteUrl: string;
      siteName: string;
      fetchedAt: string;
      /** null when that source couldn't be read (see `problems`). */
      projects: number | null;
      openIssues: number | null;
      /** null when Confluence isn't granted or couldn't be read. */
      confluenceSpaces: number | null;
      /** Workspace members who've linked their own Atlassian account. */
      linkedMembers: number;
      /** Issues updated in the last 7 days, newest first. */
      recent: Array<{
        key: string;
        summary: string;
        status: string | null;
        updated: string | null;
        url: string;
      }>;
      /** Which sources failed this time (empty when everything answered). */
      problems: string[];
    };
