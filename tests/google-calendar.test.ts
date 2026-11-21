import { describe, expect, it } from 'vitest';
import { CREDENTIALS, MockHttpClient } from './helpers.js';
import { GoogleAuthClient } from '../src/google-auth.js';
import { GoogleCalendarClient, buildEventBody } from '../src/google-calendar.js';
import { GoogleApiError } from '../src/google-api.js';

function makeClient(http: MockHttpClient): GoogleCalendarClient {
  return new GoogleCalendarClient(http, new GoogleAuthClient(http, CREDENTIALS));
}

describe('GoogleCalendarClient.listCalendars', () => {
  it('follows page tokens and maps summaries', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(200, {
      items: [{ id: 'primary', summary: 'Primary', primary: true, accessRole: 'owner' }],
      nextPageToken: 'p2',
    });
    http.respond(200, {
      items: [{ id: 'shared@example.com', summary: 'Shared', accessRole: 'reader' }],
    });
    const client = makeClient(http);

    const calendars = await client.listCalendars();

    expect(calendars).toEqual([
      { id: 'primary', summary: 'Primary', accessRole: 'owner', primary: true },
      { id: 'shared@example.com', summary: 'Shared', accessRole: 'reader', primary: false },
    ]);
    expect(new URL(http.requests[2].url).searchParams.get('pageToken')).toBe('p2');
    expect(http.requests[1].headers.Authorization).toBe('Bearer at-1');
  });

  it('surfaces API errors with the message body', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(403, { error: { message: 'Calendar API has not been enabled' } });
    http.respond(403, { error: { message: 'Calendar API has not been enabled' } });
    const client = makeClient(http);

    await expect(client.listCalendars()).rejects.toThrow(GoogleApiError);
    await expect(client.listCalendars()).rejects.toThrow('Calendar API has not been enabled');
  });
});

describe('GoogleCalendarClient.listEvents', () => {
  it('builds the expected query and slices to maxResults', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(200, {
      items: Array.from({ length: 3 }, (_, index) => ({ id: `e${index}` })),
    });
    const client = makeClient(http);

    const events = await client.listEvents({
      calendarId: 'primary',
      timeMin: '2026-01-01T00:00:00Z',
      timeMax: '2026-02-01T00:00:00Z',
      query: 'standup',
      maxResults: 2,
      orderBy: 'startTime',
    });

    expect(events).toHaveLength(2);
    const url = new URL(http.lastUrl());
    expect(url.pathname).toBe('/calendar/v3/calendars/primary/events');
    expect(url.searchParams.get('singleEvents')).toBe('true');
    expect(url.searchParams.get('timeMin')).toBe('2026-01-01T00:00:00Z');
    expect(url.searchParams.get('q')).toBe('standup');
    expect(url.searchParams.get('orderBy')).toBe('startTime');
  });

  it('includes page tokens when paged', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(200, { items: [{ id: 'a' }], nextPageToken: 't2' });
    http.respond(200, { items: [{ id: 'b' }] });
    const client = makeClient(http);

    await client.listEvents({ calendarId: 'primary' });

    expect(http.lastUrl()).toContain('pageToken=t2');
  });
});

describe('GoogleCalendarClient.createEvent', () => {
  it('posts a timed event body', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(200, { id: 'new-event' });
    const client = makeClient(http);

    const created = await client.createEvent({
      calendarId: 'primary',
      title: 'Dentist',
      description: 'Checkup',
      location: 'Clinic',
      start: '2026-03-01T09:00:00',
      end: '2026-03-01T10:00:00',
      timezone: 'America/New_York',
      attendees: ['a@example.com'],
    });

    expect(created).toEqual({ id: 'new-event' });
    const request = http.requests[1];
    expect(request.method).toBe('POST');
    expect(request.url).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none',
    );
    const body = JSON.parse(request.body ?? '{}') as Record<string, unknown>;
    expect(body.summary).toBe('Dentist');
    expect((body.start as Record<string, unknown>).dateTime).toBe('2026-03-01T09:00:00');
    expect((body.end as Record<string, unknown>).timeZone).toBe('America/New_York');
    expect(body.attendees).toEqual([{ email: 'a@example.com' }]);
  });

  it('uses all-day dates when start has no time component', async () => {
    const body = buildEventBody({
      calendarId: 'primary',
      start: '2026-03-01',
      end: '2026-03-02',
    });
    expect(body.start).toEqual({ date: '2026-03-01' });
    expect(body.end).toEqual({ date: '2026-03-02' });
  });

  it('rejects missing end for all-day events', () => {
    expect(() => buildEventBody({ calendarId: 'primary', start: '2026-03-01' })).toThrow(
      'Both start and end must be provided',
    );
  });
});

describe('GoogleCalendarClient.respond', () => {
  it('patches the self attendee response status', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(200, {
      id: 'invited-1',
      attendees: [
        { email: 'someone@example.com', self: false, responseStatus: 'needsAction' },
        { email: 'me@example.com', self: true, responseStatus: 'needsAction' },
      ],
    });
    http.respond(200, { id: 'invited-1' });
    const client = new GoogleCalendarClient(http, new GoogleAuthClient(http, CREDENTIALS));

    await client.respond('primary', 'invited-1', 'accepted');

    const patch = http.requests[2];
    expect(patch.method).toBe('PATCH');
    expect(patch.url).toContain('sendUpdates=all');
    const body = JSON.parse(patch.body ?? '{}') as { attendees: { self?: boolean }[] };
    expect(body.attendees.find((attendee) => attendee.self)?.self).toBe(true);
  });

  it('fails when the user is not an attendee', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(200, { id: 'invited-1', attendees: [] });
    const client = new GoogleCalendarClient(http, new GoogleAuthClient(http, CREDENTIALS));

    await expect(client.respond('primary', 'invited-1', 'declined')).rejects.toThrow(
      'is not an attendee',
    );
  });
});

describe('GoogleCalendarClient.deleteEvent', () => {
  it('issues a DELETE with no body', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(204, '');
    const client = makeClient(http);

    await client.deleteEvent('shared@example.com', 'e1');

    const request = http.requests[1];
    expect(request.method).toBe('DELETE');
    expect(request.url).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/shared%40example.com/events/e1?sendUpdates=none',
    );
  });
});
