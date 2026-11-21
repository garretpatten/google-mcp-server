import { GoogleApiBase } from './google-api.js';
import type { HttpClient } from './http.js';

export interface AuthenticatedClient {
  getAccessToken(): Promise<string>;
}

const API_ROOT = 'https://www.googleapis.com/calendar/v3';

export interface CalendarSummary {
  id: string;
  summary: string;
  accessRole: string;
  primary: boolean;
}

export interface EventInput {
  calendarId: string;
  eventId?: string;
  title?: string;
  description?: string;
  location?: string;
  /** ISO 8601 date or date-time, e.g. 2026-01-02 or 2026-01-02T09:00:00+01:00 */
  start?: string;
  end?: string;
  allDay?: boolean;
  timezone?: string;
  attendees?: string[];
}

export interface EventQuery {
  calendarId: string;
  timeMin?: string;
  timeMax?: string;
  query?: string;
  maxResults?: number;
  showDeleted?: boolean;
  orderBy?: 'startTime' | 'updated';
}

export interface AttendeeResponse {
  responseStatus: 'accepted' | 'declined' | 'tentative' | 'needsAction';
}

interface RawEvent {
  id?: unknown;
  status?: unknown;
  summary?: unknown;
  description?: unknown;
  location?: unknown;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  attendees?: { email?: string; self?: boolean; responseStatus?: string }[];
  htmlLink?: unknown;
  creator?: { email?: string };
  organizer?: { email?: string };
}

export class GoogleCalendarClient extends GoogleApiBase {
  constructor(http: HttpClient, auth: AuthenticatedClient) {
    super(http, auth);
  }

  /** Lists every accessible calendar: personal, shared, and subscribed. */
  async listCalendars(): Promise<CalendarSummary[]> {
    const items = await this.fetchPagedCollection(`${API_ROOT}/users/me/calendarList`, {
      maxResults: '250',
      showDeleted: 'false',
    });
    return items.map((item) => {
      const id = typeof item.id === 'string' ? item.id : '';
      const summary = typeof item.summary === 'string' ? item.summary : id;
      return {
        id,
        summary,
        accessRole: typeof item.accessRole === 'string' ? item.accessRole : 'unknown',
        primary: item.primary === true,
      };
    });
  }

  async listEvents(query: EventQuery): Promise<Record<string, unknown>[]> {
    const params: Record<string, string> = {
      maxResults: String(Math.min(query.maxResults ?? 100, 2500)),
      singleEvents: 'true',
    };
    if (query.timeMin) {
      params.timeMin = query.timeMin;
    }
    if (query.timeMax) {
      params.timeMax = query.timeMax;
    }
    if (query.query) {
      params.q = query.query;
    }
    if (query.showDeleted) {
      params.showDeleted = 'true';
    }
    if (query.orderBy) {
      params.orderBy = query.orderBy;
    }
    const items = await this.fetchPagedCollection(
      `${API_ROOT}/calendars/${encodeURIComponent(query.calendarId)}/events`,
      params,
    );
    // maxResults applies across the whole listing, not per page.
    return items.slice(0, query.maxResults ?? 100);
  }

  async getEvent(calendarId: string, eventId: string): Promise<Record<string, unknown>> {
    return this.getJson(
      `${API_ROOT}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
  }

  async createEvent(input: EventInput): Promise<Record<string, unknown>> {
    const event = buildEventBody(input);
    return this.writeJson(
      'POST',
      `${API_ROOT}/calendars/${encodeURIComponent(input.calendarId)}/events?sendUpdates=none`,
      event,
    );
  }

  async updateEvent(input: EventInput): Promise<Record<string, unknown>> {
    if (!input.eventId) {
      throw new Error('eventId is required to update an event');
    }
    const event = buildEventBody(input);
    return this.writeJson(
      'PATCH',
      `${API_ROOT}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}?sendUpdates=none`,
      event,
    );
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await this.writeJson(
      'DELETE',
      `${API_ROOT}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    );
  }

  /** Sets the authenticated user's response (RSVP) on an invitation. */
  async respond(
    calendarId: string,
    eventId: string,
    responseStatus: AttendeeResponse['responseStatus'],
  ): Promise<Record<string, unknown>> {
    const raw = (await this.getEvent(calendarId, eventId)) as RawEvent;
    const attendees = raw.attendees ?? [];
    let updated = false;
    for (const attendee of attendees) {
      if (attendee.self === true) {
        attendee.responseStatus = responseStatus;
        updated = true;
        break;
      }
    }
    if (!updated) {
      throw new Error(
        `Cannot respond to event ${eventId}: the authenticated user is not an attendee`,
      );
    }
    return this.writeJson(
      'PATCH',
      `${API_ROOT}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      { attendees },
    );
  }
}

export function buildEventBody(input: EventInput): Record<string, unknown> {
  const event: Record<string, unknown> = {};

  if (input.title !== undefined) {
    event.summary = input.title;
  }
  if (input.description !== undefined) {
    event.description = input.description;
  }
  if (input.location !== undefined) {
    event.location = input.location;
  }
  if (input.attendees !== undefined) {
    event.attendees = input.attendees.map((email) => ({ email }));
  }

  if (input.start !== undefined || input.end !== undefined) {
    if (input.start === undefined || input.end === undefined) {
      throw new Error('Both start and end must be provided');
    }
    const start = input.start;
    const end = input.end;
    const key = input.allDay === true || !start.includes('T') ? 'date' : 'dateTime';
    event.start = key === 'date' ? { date: start } : { dateTime: start, timeZone: input.timezone };
    event.end = key === 'date' ? { date: end } : { dateTime: end, timeZone: input.timezone };
  }

  return event;
}
