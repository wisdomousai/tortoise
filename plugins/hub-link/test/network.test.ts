import { expect, test } from 'bun:test';
import { hubNetworkPort, hubOrigin, type Link } from '../src/network';

test('a hub is reached over https, or over http only on loopback', () => {
  expect(hubOrigin('https://hub.plant.example:8443/path')).toBe('https://hub.plant.example:8443');
  expect(hubOrigin('http://127.0.0.1:4100')).toBe('http://127.0.0.1:4100');
  expect(hubOrigin('http://localhost:4100')).toBe('http://localhost:4100');
  expect(() => hubOrigin('http://192.168.1.20:4100')).toThrow('over https');
  expect(() => hubOrigin('ftp://hub.plant.example')).toThrow('over https');
  expect(() => hubOrigin('hub.plant.example')).toThrow('not a URL');
});

test('the device credential goes only to the paired origin, never through a redirect', async () => {
  let link: Link | undefined;
  const sent: { url: string; authorization: string | null; redirect?: RequestRedirect }[] = [];
  const port = hubNetworkPort(() => link, (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    sent.push({
      url: String(input),
      authorization: new Headers(init?.headers).get('Authorization'),
      ...(init?.redirect ? { redirect: init.redirect } : {}),
    });
    return new Response('{}');
  }) as typeof fetch);
  const hub = port.client('hub');
  await expect(hub.fetch('/api/v1/queries/feed')).rejects.toThrow('not paired');

  link = { origin: 'https://hub.plant.example', token: 'device-token' };
  await hub.fetch('/api/v1/queries/feed', { headers: { Authorization: 'Bearer other' } });
  expect(sent).toEqual([
    {
      url: 'https://hub.plant.example/api/v1/queries/feed',
      authorization: 'Bearer device-token',
      redirect: 'error',
    },
  ]);
  await expect(hub.fetch('https://elsewhere.example/api')).rejects.toThrow(
    'Only the paired hub is reachable',
  );
  expect(() => port.client('model')).toThrow('unreachable from this device');
  expect(() => port.routedFetch(['hub', 'eam'])).toThrow('unreachable from this device');
  expect(sent).toHaveLength(1);
});
