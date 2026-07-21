/**
 * Confluence's v2 REST API requires GRANULAR OAuth scopes, which take the form
 * `<action>:<resource>:confluence` (e.g. `read:page:confluence`). The legacy
 * classic scopes (`read:confluence-content.all`, …) only worked with the v1 API
 * that Atlassian has removed. A granular scope always ends with `:confluence`,
 * whereas classic ones end with `.all` / `.summary`, so that suffix cleanly
 * distinguishes the two.
 */
export function hasGranularConfluence(scopes: string | null | undefined): boolean {
  if (!scopes) return false;
  return scopes.split(/\s+/).some((s) => s.endsWith(':confluence'));
}
