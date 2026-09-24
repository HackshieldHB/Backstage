'use client';

import { useQuery } from '@tanstack/react-query';
import { applicationService } from './service';

/** All registered applications (identity + status + card metrics). */
export function useApplications() {
  return useQuery({
    queryKey: ['applications'],
    queryFn: () => applicationService.getApplications(),
    staleTime: 30_000,
  });
}

/** One application's identity. */
export function useApplication(id: string | null) {
  return useQuery({
    queryKey: ['application', id],
    queryFn: () => applicationService.getApplication(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
}

/** Domain data for one application (fetched lazily when a preview/detail opens). */
export function useApplicationData(id: string | null) {
  return useQuery({
    queryKey: ['application-data', id],
    queryFn: () => applicationService.getApplicationData(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useGlobalActivity() {
  return useQuery({
    queryKey: ['application-activity'],
    queryFn: () => applicationService.getGlobalActivity(),
    staleTime: 30_000,
  });
}
