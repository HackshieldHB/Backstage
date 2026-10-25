/**
 * Presence in Backstages' own words: people are on stage, in the wings, or off
 * stage. `plain` is the conventional term, shown alongside where it helps.
 */
export const STAGE_PRESENCE: Record<
  'ACTIVE' | 'AWAY' | 'DND' | 'OFFLINE',
  { label: string; plain: string }
> = {
  ACTIVE: { label: 'On stage', plain: 'Active' },
  AWAY: { label: 'In the wings', plain: 'Away' },
  DND: { label: 'Do not disturb', plain: 'Do not disturb' },
  OFFLINE: { label: 'Off stage', plain: 'Offline' },
};

/** Label for any presence string from the API (unknown values read as offline). */
export function presenceLabel(presence: string | null | undefined): string {
  return (STAGE_PRESENCE[presence as keyof typeof STAGE_PRESENCE] ?? STAGE_PRESENCE.OFFLINE).label;
}
