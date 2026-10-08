import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
  developmentAppName,
  developmentServiceEnvironment,
  developmentServiceLaunch,
  isDevelopmentDesktop,
} from '../src/development-launch';

const root = resolve('repo-root');
const workspace = resolve('work');
const env: NodeJS.ProcessEnv = {
  AGENT_NATIVE_DESKTOP_DEV: '1',
  AGENT_NATIVE_APPLICATION: '@agent-native/project-tasks',
  AGENT_NATIVE_BUN: process.execPath,
  AGENT_NATIVE_SERVICE_ENTRY: resolve('apps/service/src/index.ts'),
  AGENT_NATIVE_WEB_ROOT: resolve('dist/web/project-tasks'),
  AGENT_NATIVE_DEV_ROOT: root,
  AGENT_NATIVE_SITE_POLICY: resolve('apps/desktop/site-policy.json'),
  PORT: '4321',
  STATION_HMI_URL: 'http://127.0.0.1:4610',
  ELECTRON_RUN_AS_NODE: '1',
  NODE_OPTIONS: '--require something',
  OPENAI_API_KEY: 'ambient',
};

test('a packaged app ignores the development flag', () => {
  expect(isDevelopmentDesktop(true, env)).toBe(false);
  expect(isDevelopmentDesktop(false, env)).toBe(true);
  expect(isDevelopmentDesktop(false, { AGENT_NATIVE_DESKTOP_DEV: 'yes' })).toBe(false);
});

test('development launches use the source service and keep host-owned paths', () => {
  const launch = developmentServiceLaunch(env, workspace);
  expect(launch.executable).toBe(process.execPath);
  expect(launch.args).toEqual([resolve('apps/service/src/index.ts')]);
  expect(launch.webRoot).toBe(resolve('dist/web/project-tasks'));
  expect(launch.cwd).toBe(root);
  expect(launch.port).toBe('4321');
  expect(launch.sitePolicy).toBe(resolve('apps/desktop/site-policy.json'));
  expect('runtimeManifest' in launch).toBe(false);
  expect(launch.extraEnv.STATION_HMI_URL).toBe('http://127.0.0.1:4610');
  expect(launch.extraEnv.OPENAI_API_KEY).toBe('ambient');
  expect(launch.extraEnv.ELECTRON_RUN_AS_NODE).toBeUndefined();
  expect(launch.extraEnv.NODE_OPTIONS).toBeUndefined();
  expect(launch.extraEnv.PORT).toBeUndefined();
  expect(launch.extraEnv.WEB_ROOT).toBeUndefined();
  expect(launch.extraEnv.AGENT_NATIVE_SITE_POLICY).toBeUndefined();
});

test('development launch refuses relative paths and a missing flag', () => {
  expect(() => developmentServiceLaunch(env, 'relative')).toThrow('absolute');
  expect(() =>
    developmentServiceLaunch({ ...env, AGENT_NATIVE_WEB_ROOT: 'dist/web' }, workspace),
  ).toThrow('absolute');
  expect(() => developmentServiceLaunch({ ...env, PORT: 'nope' }, workspace)).toThrow('PORT');
  const withoutFlag = { ...env };
  delete withoutFlag.AGENT_NATIVE_DESKTOP_DEV;
  expect(() => developmentServiceLaunch(withoutFlag, workspace)).toThrow('Not a development');
});

test('each development application gets its own single-instance name', () => {
  expect(developmentAppName('agent-native-desktop-starter', '@agent-native/project-tasks')).toBe(
    'agent-native-desktop-starter.agent-native-project-tasks',
  );
  expect(developmentAppName('agent-native-desktop-starter', undefined)).toBe(
    'agent-native-desktop-starter',
  );
});

test('the forwarded environment drops electron control variables', () => {
  const forwarded = developmentServiceEnvironment(env);
  expect(forwarded.ELECTRON_RUN_AS_NODE).toBeUndefined();
  expect(forwarded.STATION_HMI_URL).toBe('http://127.0.0.1:4610');
});
