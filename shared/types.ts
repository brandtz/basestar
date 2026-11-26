// Types shared by the API (server/) and the web app (src/).

export type Role = 'super' | 'manager' | 'staff';

/** Times are local wall-clock "HH:MM" (24h) in the center's timezone. */
export interface Shift {
  start: string;
  end: string;
  lunchStart?: string;
  lunchEnd?: string;
  note?: string;
}

/** Regular weekly pattern, keyed by weekday "0" (Sun) … "6" (Sat). Missing/empty = off. */
export type Weekly = Partial<Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', Shift[]>>;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  title?: string;
  role: Role;
  color: string;
  active: boolean;
  weekly: Weekly;
  email?: string;
  /** Only included for managers. */
  hasPassword?: boolean;
  lastLoginAt?: string;
  gustoEmployeeUuid?: string;
}

export interface Settings {
  orgName: string;
  timezone: string;
  weekStartsOn: 0 | 1;
  showWeekends: boolean;
  /** Swaps and covers between coworkers. */
  swapsNeedApproval: boolean;
  /** Someone changing their own hours for a day. */
  changesNeedApproval: boolean;
  timeOffNeedsApproval: boolean;
  /** Shown under the clock-in button. Blank to hide. */
  clockReminder: string;
}

export type WorkState = 'out' | 'in' | 'break' | 'lunch';

export interface StatusEntry {
  state: WorkState;
  /** ISO timestamp of the last state change. */
  since: string;
  clockedInAt?: string;
  updatedBy?: string;
}

export type PunchType = 'clock_in' | 'clock_out' | 'break_start' | 'break_end' | 'lunch_start' | 'lunch_end';

export interface Punch {
  id: string;
  userId: string;
  type: PunchType;
  at: string;
  by: string;
}

export type TimeOffType = 'vacation' | 'sick' | 'personal' | 'unpaid' | 'other';
export type TimeOffStatus = 'pending' | 'approved' | 'denied' | 'cancelled';

export interface TimeOff {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  type: TimeOffType;
  note?: string;
  status: TimeOffStatus;
  createdAt: string;
  createdBy: string;
  decidedAt?: string;
  decidedBy?: string;
}

export interface Closure {
  id: string;
  startDate: string;
  endDate: string;
  name: string;
  createdAt: string;
  createdBy: string;
}

export type ShiftRequestType = 'swap' | 'cover' | 'change';
export type ShiftRequestStatus = 'awaiting_peer' | 'awaiting_manager' | 'approved' | 'declined' | 'denied' | 'cancelled';

export interface ShiftRequest {
  id: string;
  type: ShiftRequestType;
  date: string;
  requesterId: string;
  targetId?: string;
  /** Snapshots at request time, for display. */
  requesterShifts: Shift[];
  targetShifts?: Shift[];
  proposedShifts?: Shift[];
  note?: string;
  status: ShiftRequestStatus;
  createdAt: string;
  peerRespondedAt?: string;
  decidedAt?: string;
  decidedBy?: string;
}

export interface DayEntry {
  userId: string;
  shifts: Shift[];
  source: 'regular' | 'changed';
  timeOff?: Pick<TimeOff, 'id' | 'type' | 'allDay' | 'startTime' | 'endTime' | 'status' | 'note'>;
}

export interface ScheduleDay {
  date: string;
  closure?: { id: string; name: string };
  entries: DayEntry[];
}

export interface BoardPerson {
  userId: string;
  state: WorkState;
  since?: string;
  clockedInAt?: string;
  /** Left clocked in on a previous day. */
  stale?: boolean;
  shifts: Shift[];
  timeOff?: DayEntry['timeOff'];
}

export interface Board {
  now: string;
  today: string;
  closure?: { id: string; name: string };
  people: BoardPerson[];
  pendingForMe: number;
}

export interface TimesheetDay {
  date: string;
  firstIn?: string;
  lastOut?: string;
  onClockMinutes: number;
  lunchMinutes: number;
  breakMinutes: number;
  workedMinutes: number;
  /** Still on the clock (today); minutes run up to now. */
  open?: boolean;
  /** At least one entry was made by a manager on this person's behalf. */
  adjusted?: boolean;
  flags: string[];
}

export interface TimesheetRow {
  userId: string;
  days: TimesheetDay[];
  totalWorkedMinutes: number;
}
