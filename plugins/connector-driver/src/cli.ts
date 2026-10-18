import { writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { takeFlag } from '@agent-native/adapters/cli';
import { ApplicationError } from '@agent-native/contracts';
import type { PluginCommand } from '@agent-native/host/plugin';
import { baseEnvironment, startChild, terminateTree } from '@agent-native/process/spawn';
import type { DriverContract } from './contracts/define';
import { driverContractDocument } from './contracts/document';
import { driverContractDigest, type DriverProcess } from './supervisor';
import { checkDriver } from './testing/check';

const usage = (message: string) => new ApplicationError('INVALID_INPUT', message);

export const driverUsage = (program: string) => `Drivers (offline; no instance or workspace needed):
  ${program} driver list
      each declared driver: the process ID to bind in the site policy, its contract digest,
      and its actions with delivery mode and hazard class
  ${program} driver check <driver-id> -- <absolute executable> [args...]
      start the executable and check it against the driver's contract; never invokes an action
  ${program} driver contract <driver-id> [--out file]
      the contract document and its digest as JSON, for the Python and .NET stub generators
`;

function list(contracts: readonly DriverContract[]) {
  const lines: string[] = [];
  for (const contract of contracts) {
    lines.push(`${contract.id} ${contract.version}  ${contract.title}`);
    lines.push(`  process  ${contract.process.id} (${contract.process.availability})`);
    lines.push(`  digest   ${driverContractDigest(contract)}`);
    for (const [id, action] of Object.entries(contract.actions))
      lines.push(`  action   ${id}  ${action.delivery}, hazard ${action.hazard}`);
  }
  process.stdout.write(lines.length ? `${lines.join('\n')}\n` : 'No driver is declared.\n');
  return 0;
}

/**
 * Start an executable outside the site policy, for a developer or site administrator checking a
 * build before binding it. It starts through the process plugin's own spawn, with its base
 * environment: nothing the host holds (credentials, proxies, loader variables) reaches the driver.
 */
async function startExecutable(
  contract: DriverContract,
  executable: string,
  args: readonly string[],
): Promise<DriverProcess> {
  const child = await startChild(
    {
      process: { ...contract.process, executable, owner: 'driver', targets: [contract.id] },
      executable,
      args,
      env: {},
    },
    [],
    baseEnvironment(),
  ).catch(() => {
    throw usage(`Could not start ${executable}`);
  });
  return {
    child,
    terminate: () => {
      terminateTree(child, false);
      setTimeout(() => terminateTree(child, true), 2_000).unref();
    },
  };
}

async function check(contracts: readonly DriverContract[], args: string[]) {
  const separator = args.indexOf('--');
  const [id, ...extra] = separator < 0 ? args : args.slice(0, separator);
  const [executable, ...rest] = separator < 0 ? [] : args.slice(separator + 1);
  if (!id || extra.length) throw usage('driver check takes one driver ID');
  const contract = contracts.find((item) => item.id === id);
  if (!contract) throw usage(`No driver ${id} is declared; see driver list`);
  if (!executable || !isAbsolute(executable))
    throw usage('driver check needs an absolute executable after --');
  const checks = await checkDriver({
    contract,
    start: () => startExecutable(contract, executable, rest),
  });
  for (const item of checks)
    process.stdout.write(
      `${item.passed ? 'pass' : 'FAIL'}  ${item.name}${item.detail ? `  ${item.detail}` : ''}\n`,
    );
  return checks.every((item) => item.passed) ? 0 : 1;
}

/**
 * The file the stub generators read: the contract document and its digest. The generators
 * recompute the digest from the document and refuse a file where they differ.
 */
export function driverContractFile(contract: DriverContract) {
  return { digest: driverContractDigest(contract), document: driverContractDocument(contract) };
}

async function contractFile(contracts: readonly DriverContract[], args: string[]) {
  const out = takeFlag(args, 'out');
  const [id, ...extra] = args;
  if (!id || extra.length) throw usage('driver contract takes one driver ID');
  const contract = contracts.find((item) => item.id === id);
  if (!contract) throw usage(`No driver ${id} is declared; see driver list`);
  const text = `${JSON.stringify(driverContractFile(contract), null, 2)}\n`;
  if (out) await writeFile(resolve(out), text, { mode: 0o644 });
  else process.stdout.write(text);
  return 0;
}

/** `driver list`, `driver check` and `driver contract` for one application's drivers. */
export function driverCliCommand(contracts: readonly DriverContract[]): PluginCommand {
  return {
    usage: driverUsage,
    async run(_manifest, args) {
      const [verb, sub, ...rest] = args;
      if (verb !== 'driver') return undefined;
      if (sub === 'list' && !rest.length) return list(contracts);
      if (sub === 'check') return check(contracts, rest);
      if (sub === 'contract') return contractFile(contracts, rest);
      throw usage('Unknown driver command; see help');
    },
  };
}
