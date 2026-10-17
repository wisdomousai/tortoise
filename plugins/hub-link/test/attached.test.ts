import { expect, test } from 'bun:test';
import { hubPageAllows, requestLaunch } from '../src/attached';

test('the hub web view loads only the hub origin', () => {
  const origin = 'https://hub.site.example:8443';
  expect(hubPageAllows('https://hub.site.example:8443/#launch=k', origin)).toBe(true);
  expect(hubPageAllows('https://hub.site.example:8443/api/v1/events', origin)).toBe(true);
  expect(hubPageAllows('https://hub.site.example/', origin)).toBe(false);
  expect(hubPageAllows('http://hub.site.example:8443/', origin)).toBe(false);
  expect(hubPageAllows('https://elsewhere.example/', origin)).toBe(false);
  expect(hubPageAllows('about:blank', origin)).toBe(false);
  expect(hubPageAllows('file:///data/app', origin)).toBe(false);
  expect(hubPageAllows('javascript:alert(1)', origin)).toBe(false);
  expect(hubPageAllows('not a url', origin)).toBe(false);
});

test('a launch key is requested with the device credential and put in the fragment', async () => {
  const link = { origin: 'https://hub.site.example', token: 'device-token' };
  const sent: { url: string; init?: RequestInit }[] = [];
  const page = await requestLaunch(
    (async (input: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(input), ...(init ? { init } : {}) });
      return Response.json({ launch: 'one-use' });
    }) as typeof fetch,
    link,
  );
  expect(page).toEqual({ origin: link.origin, url: 'https://hub.site.example/#launch=one-use' });
  expect(sent[0]!.url).toBe('https://hub.site.example/api/v1/launch');
  expect(new Headers(sent[0]!.init?.headers).get('Authorization')).toBe('Bearer device-token');
  expect(sent[0]!.init?.redirect).toBe('error');

  const refused = (async () =>
    Response.json(
      { error: { code: 'FORBIDDEN', message: 'Local session required' } },
      { status: 403 },
    )) as unknown as typeof fetch;
  await expect(requestLaunch(refused, link)).rejects.toThrow('Local session required');
  const down = (async () => {
    throw new TypeError('Network is unreachable');
  }) as unknown as typeof fetch;
  await expect(requestLaunch(down, link)).rejects.toThrow('could not be reached');
});
