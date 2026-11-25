// Gusto integration seam.
//
// Gusto's Time Tracking API accepts *completed shifts* (not live punches):
//   POST /v1/companies/{company_uuid}/time_tracking/time_sheets   (X-Gusto-API-Version: 2024-04-01)
// with shift_started_at / shift_ended_at (UTC), time_zone, and classified hour entries.
// Using it requires a Time Tracking app in the Gusto Developer Portal, an OAuth connection
// to the company, and turning off Gusto's own time tracking. See README "Gusto".
//
// Until that's set up, this is a no-op. When it is, implement `sendCompletedShift` and set
// GUSTO_ENABLED=true plus the OAuth credentials in Netlify environment variables.

export interface CompletedShift {
  userId: string;
  gustoEmployeeUuid?: string;
  clockedInAt: string;
  clockedOutAt: string;
  lunchMinutes: number;
  breakMinutes: number;
  timezone: string;
}

export const gustoEnabled = () => process.env.GUSTO_ENABLED === 'true';

export async function sendCompletedShift(_shift: CompletedShift): Promise<void> {
  if (!gustoEnabled()) return;
  // TODO(gusto): exchange refresh token, then POST the time sheet. Classify overtime per
  // Oregon rules before sending (Gusto requires classified hours: regular / overtime / double).
}
