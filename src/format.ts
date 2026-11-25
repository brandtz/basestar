import type { Shift, TimeOffType } from '../shared/types';
import { tz } from './state';

/** "13:05" -> "1:05 PM" */
export function time12(hhmm?: string): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "13:00" -> "1p", "07:30" -> "7:30a" (for tight grids) */
export function timeShort(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const hr = h % 12 || 12;
  return `${hr}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'a' : 'p'}`;
}

export const shiftRange = (s: Shift) => `${time12(s.start)} – ${time12(s.end)}`;
export const shiftsText = (list: Shift[]) => (list.length ? list.map(shiftRange).join(', ') : 'Off');
export const shiftsShort = (list: Shift[]) => list.map((s) => `${timeShort(s.start)}–${timeShort(s.end)}`).join(', ');

export function clockOf(iso?: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function minutesSince(iso: string | undefined, now: number): number {
  return iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 60000)) : 0;
}

export function duration(mins: number): string {
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export const hours = (mins: number) => (mins / 60).toFixed(2);

const D = (date: string) => new Date(date + 'T12:00:00Z');
export const dayLong = (date: string) =>
  D(date).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
export const dayMed = (date: string) =>
  D(date).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
export const weekdayShort = (date: string) => D(date).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
export const dayNum = (date: string) => D(date).getUTCDate();
export const monthDay = (date: string) => D(date).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

export function dateSpan(a: string, b: string) {
  return a === b ? dayMed(a) : `${dayMed(a)} – ${dayMed(b)}`;
}

export const TIME_OFF_LABEL: Record<TimeOffType, string> = {
  vacation: 'Vacation', sick: 'Sick', personal: 'Personal', unpaid: 'Unpaid', other: 'Time off',
};

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
