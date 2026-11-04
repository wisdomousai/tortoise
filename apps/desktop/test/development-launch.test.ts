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
  TORTOISE_DESKTOP_DEV: '1',
  TORTOISE_APPLICATION: '@tortoise/field-service',
  TORTOISE_BUN: process.execPath,
  TORTOISE_SERVICE_ENTRY: resolve('apps/service/src/index.ts'),
  TORTOISE_WEB_ROOT: resolve('dist/web/field-service'),
  TORTOISE_DEV_ROOT: root,
  TORTOISE_DEPLOYMENT_POLICY: resolve('apps/desktop/deployment-policy.json'),
  PORT: '4321',
  STATION_HMI_URL: 'http://127.0.0.1:4610',
  ELECTRON_RUN_AS_NODE: '1',
  NODE_OPTIONS: '--require something',
  OPENAI_API_KEY: 'ambient',
};

test('a packaged app ignores the development flag', () => {
  expect(isDevelopmentDesktop(true, env)).toBe(false);
  expect(isDevelopmentDesktop(false, env)).toBe(true);
  expect(isDevelopmentDesktop(false, { TORTOISE_DESKTOP_DEV: 'yes' })).toBe(false);
});

test('development launches use the source service and keep host-owned paths', () => {
  const launch = developmentServiceLaunch(env, workspace);
  expect(launch.executable).toBe(process.execPath);
  expect(launch.args).toEqual([resolve('apps/service/src/index.ts')]);
  expect(launch.webRoot).toBe(resolve('dist/web/field-service'));
  expect(launch.cwd).toBe(root);
  expect(launch.port).toBe('4321');
  expect(launch.deploymentPolicy).toBe(resolve('apps/desktop/deployment-policy.json'));
  expect('runtimeManifest' in launch).toBe(false);
  expect(launch.extraEnv.STATION_HMI_URL).toBe('http://127.0.0.1:4610');
  expect(launch.extraEnv.OPENAI_API_KEY).toBe('ambient');
  expect(launch.extraEnv.ELECTRON_RUN_AS_NODE).toBeUndefined();
  expect(launch.extraEnv.NODE_OPTIONS).toBeUndefined();
  expect(launch.extraEnv.PORT).toBeUndefined();
  expect(launch.extraEnv.WEB_ROOT).toBeUndefined();
  expect(launch.extraEnv.TORTOISE_DEPLOYMENT_POLICY).toBeUndefined();
});

test('development launch refuses relative paths and a missing flag', () => {
  expect(() => developmentServiceLaunch(env, 'relative')).toThrow('absolute');
  expect(() =>
    developmentServiceLaunch({ ...env, TORTOISE_WEB_ROOT: 'dist/web' }, workspace),
  ).toThrow('absolute');
  expect(() => developmentServiceLaunch({ ...env, PORT: 'nope' }, workspace)).toThrow('PORT');
  const withoutFlag = { ...env };
  delete withoutFlag.TORTOISE_DESKTOP_DEV;
  expect(() => developmentServiceLaunch(withoutFlag, workspace)).toThrow('Not a development');
});

test('each development application gets its own single-instance name', () => {
  // One literal: a scaffold export renames it, and the calls must not depend on its length.
  const appName = 'tortoise-starter';
  expect(developmentAppName(appName, '@tortoise/field-service')).toBe(
    `${appName}.tortoise-field-service`,
  );
  expect(developmentAppName(appName, undefined)).toBe(appName);
});

test('the forwarded environment drops electron control variables', () => {
  const forwarded = developmentServiceEnvironment(env);
  expect(forwarded.ELECTRON_RUN_AS_NODE).toBeUndefined();
  expect(forwarded.STATION_HMI_URL).toBe('http://127.0.0.1:4610');
});
