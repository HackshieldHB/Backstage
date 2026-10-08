'use client';

import { createContext, useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AtlassianOverviewDto } from '@backstages/shared';
import { api } from '@/lib/api';
import { applicationService, WorkspaceApplicationService, type ApplicationService } from './service';

/** The workspace the Applications Hub is showing (null = sample data only). */
export const ApplicationsWorkspaceContext = createContext<string | null>(null);

function useService(): { ws: string | null; service: ApplicationService } {
  const ws = useContext(ApplicationsWorkspaceContext);
  const service = useMemo(
    () =>
      ws
        ? new WorkspaceApplicationService(() =>
            api<AtlassianOverviewDto>('GET', `/workspaces/${ws}/applications/atlassian`),
          )
        : applicationService,
    [ws],
  );
  return { ws, service };
}

/** All registered applications (identity + status + card metrics). */
export function useApplications() {
  const { ws, service } = useService();
  return useQuery({
    queryKey: ['applications', ws],
    queryFn: () => service.getApplications(),
    staleTime: 30_000,
  });
}

/** One application's identity. */
export function useApplication(id: string | null) {
  const { ws, service } = useService();
  return useQuery({
    queryKey: ['application', ws, id],
    queryFn: () => service.getApplication(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
}

/** Domain data for one application (fetched lazily when a preview/detail opens). */
export function useApplicationData(id: string | null) {
  const { ws, service } = useService();
  return useQuery({
    queryKey: ['application-data', ws, id],
    queryFn: () => service.getApplicationData(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useGlobalActivity() {
  const { ws, service } = useService();
  return useQuery({
    queryKey: ['application-activity', ws],
    queryFn: () => service.getGlobalActivity(),
    staleTime: 30_000,
  });
}
