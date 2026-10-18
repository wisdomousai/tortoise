/**
 * The parts of the overview map that no manifest declares: the request paths, the operating
 * properties, the port table and each example's input route and system of record. Every entry
 * names the files and tests that back it, and `scripts/overview.ts` refuses to generate when a
 * file is missing, a test name is absent from its file or a doc anchor does not exist. A claim
 * here therefore stays true of the code, or `bun run check` fails.
 */

/** A test that proves a statement: the file and the exact name passed to `test(...)`. */
export interface TestReference {
  readonly file: string;
  readonly test: string;
}

/** A guide page and an optional heading on it, as `page` or `page#anchor` under `docs/`. */
export type DocReference = string;

export type Lane = 'world' | 'surfaces' | 'instance' | 'delivery' | 'records';

export const lanes: ReadonlyArray<{ readonly id: Lane; readonly title: string }> = [
  { id: 'world', title: 'Point of work' },
  { id: 'surfaces', title: 'Surfaces' },
  { id: 'instance', title: 'Instance' },
  { id: 'delivery', title: 'Delivery' },
  { id: 'records', title: 'Systems of record' },
];

export interface Step {
  readonly id: string;
  readonly lane: Lane;
  readonly title: string;
  readonly summary: string;
  readonly doc: DocReference;
  readonly sources: readonly string[];
  readonly tests: readonly TestReference[];
}

export interface RequestPath {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly Step[];
}

const live: Step = {
  id: 'live',
  lane: 'surfaces',
  title: 'Live query',
  summary:
    'Every open screen whose reads changed refetches from the journal, filtered by current read access.',
  doc: 'state-and-reactivity#live-queries',
  sources: ['packages/client/src', 'packages/react/src'],
  tests: [
    {
      file: 'packages/client/src/client.test.ts',
      test: 'snapshot cursor closes subscription race and clear fences an old in-flight response',
    },
  ],
};

export const paths: readonly RequestPath[] = [
  {
    id: 'outbound',
    title: 'Command and delivery',
    steps: [
      {
        id: 'input',
        lane: 'world',
        title: 'Input',
        summary:
          "An operator presses a control, a scanner reads a code, a driver reports a reading or an observer reads a workstation application's screen.",
        doc: 'point-of-work-input',
        sources: [
          'packages/devices/src',
          'packages/observation/src',
          'workstations/screen-bridge/src',
          'plugins/connector-driver/src',
        ],
        tests: [
          {
            file: 'packages/devices/test/scanner.test.ts',
            test: 'routes match GS1 AIs and patterns in order',
          },
          {
            file: 'packages/observation/test/observation.test.ts',
            test: 'a reading passes the gate once it agrees across stable reads, with device provenance',
          },
          {
            file: 'workstations/screen-bridge/test/observer.test.ts',
            test: 'readings are submitted only once stable, with provenance',
          },
        ],
      },
      {
        id: 'surface',
        lane: 'surfaces',
        title: 'Surface',
        summary:
          'The screen, HTTP, MCP or the CLI validates the input and derives the principal, workspace and grant from the session.',
        doc: 'architecture#surfaces-and-identity',
        sources: ['packages/adapters/src', 'packages/host/src'],
        tests: [
          {
            file: 'examples/project-tasks/test/transport-conformance.test.ts',
            test: 'direct, HTTP, CLI subprocess and MCP protocol share scoped results, errors and idempotent commits',
          },
        ],
      },
      {
        id: 'command',
        lane: 'instance',
        title: 'Command',
        summary:
          'The runtime runs the handler and authorizes the operation, object and fields inside the transaction.',
        doc: 'authorization#command-checks',
        sources: ['packages/runtime/src'],
        tests: [
          {
            file: 'packages/runtime/test/runtime.test.ts',
            test: 'commit authorization and cancellation are rechecked after handler work',
          },
        ],
      },
      {
        id: 'commit',
        lane: 'instance',
        title: 'Commit',
        summary:
          'State, revisions, the receipt, journal entries and the outbox effect commit in one transaction, and the caller receives the receipt.',
        doc: 'systems-of-record#outbox-and-settlement',
        sources: ['packages/runtime/src', 'packages/adapters/src/row-storage.ts'],
        tests: [
          {
            file: 'packages/runtime/test/outbox.test.ts',
            test: 'a committed command persists its effect with the receipt and journal',
          },
          {
            file: 'packages/runtime/test/outbox.test.ts',
            test: 'a rolled-back command commits no effect',
          },
        ],
      },
      live,
      {
        id: 'dispatch',
        lane: 'delivery',
        title: 'Dispatcher',
        summary:
          'The dispatcher claims the effect and delivers it outside any transaction, at least once.',
        doc: 'systems-of-record#worker-claims',
        sources: ['packages/integration/src/dispatcher.ts'],
        tests: [
          {
            file: 'packages/integration/test/dispatcher.test.ts',
            test: 'delivers outside the transaction and settles through the domain command',
          },
          {
            file: 'examples/quality-inspection/domain.test.ts',
            test: 'an unavailable SoR leaves captured data committed and visibly retrying',
          },
        ],
      },
      {
        id: 'connector',
        lane: 'delivery',
        title: 'Connector',
        summary:
          "The connector reaches the system of record through the network port, an exchange folder, a driver process or a workstation application's screen.",
        doc: 'systems-of-record#connectors',
        sources: [
          'plugins/connector-http/src',
          'plugins/connector-files/src',
          'plugins/connector-driver/src',
          'workstations/screen-bridge/src',
        ],
        tests: [
          {
            file: 'plugins/connector-http/test/connector-http.test.ts',
            test: 'every request goes to the declared destination through the network port',
          },
          {
            file: 'workstations/screen-bridge/test/controller.test.ts',
            test: 'a procedure runs through the screen and is accepted by readback',
          },
        ],
      },
      {
        id: 'target',
        lane: 'records',
        title: 'Decision',
        summary:
          'The ERP, MES, QMS, CRM or EAM accepts the change, rejects it or acknowledges it without a decision.',
        doc: 'systems-of-record#effect-phases',
        sources: ['packages/integration/src'],
        tests: [
          {
            file: 'packages/integration/test/dispatcher.test.ts',
            test: 'a target rejection settles as business data instead of retrying',
          },
        ],
      },
      {
        id: 'settle',
        lane: 'instance',
        title: 'Settle',
        summary:
          'A settle command commits the outcome with its domain update once; an outcome nobody can tell is held for a person.',
        doc: 'systems-of-record#held-effects',
        sources: ['packages/runtime/src', 'packages/integration/src'],
        tests: [
          {
            file: 'packages/runtime/test/outbox.test.ts',
            test: 'settlement commits the outcome with its domain update exactly once',
          },
          {
            file: 'packages/integration/test/held.test.ts',
            test: 'an interrupted procedure is held, skipped by delivery and resolved by reconciliation',
          },
        ],
      },
    ],
  },
  {
    id: 'inbound',
    title: 'Inbound sync',
    steps: [
      {
        id: 'feed',
        lane: 'records',
        title: 'Feed',
        summary: 'The target returns the records that changed after a watermark, page by page.',
        doc: 'systems-of-record#inbound-sync',
        sources: ['packages/integration/src'],
        tests: [
          {
            file: 'packages/integration/test/dispatcher.test.ts',
            test: 'pulls target pages into watermark-bound sync commands',
          },
        ],
      },
      {
        id: 'sync',
        lane: 'delivery',
        title: 'Inbound sync',
        summary:
          'Inbound sync submits each page as a sync command bound to the watermark and never writes storage itself.',
        doc: 'systems-of-record#inbound-sync',
        sources: ['packages/integration/src'],
        tests: [
          {
            file: 'packages/integration/test/dispatcher.test.ts',
            test: 'pulls target pages into watermark-bound sync commands',
          },
        ],
      },
      {
        id: 'sync-commit',
        lane: 'instance',
        title: 'Commit',
        summary:
          'The sync command commits the working-set copy as the integration principal, which cannot drive operator commands.',
        doc: 'systems-of-record#inbound-sync',
        sources: ['packages/runtime/src'],
        tests: [
          {
            file: 'packages/integration/test/dispatcher.test.ts',
            test: 'the integration grant cannot drive operator commands',
          },
        ],
      },
      live,
    ],
  },
  {
    id: 'remote',
    title: 'Remote query',
    steps: [
      {
        id: 'remote-call',
        lane: 'surfaces',
        title: 'Query',
        summary: 'A screen, an agent or the CLI calls a query that names a remote source.',
        doc: 'systems-of-record#remote-queries',
        sources: ['packages/runtime/src'],
        tests: [
          {
            file: 'packages/runtime/test/remote-query.test.ts',
            test: 'a denied caller never reaches the source',
          },
        ],
      },
      {
        id: 'remote-authorize',
        lane: 'instance',
        title: 'Remote query',
        summary: 'The runtime authorizes the caller, then asks the source outside the snapshot.',
        doc: 'systems-of-record#remote-queries',
        sources: ['packages/runtime/src'],
        tests: [
          {
            file: 'packages/runtime/test/remote-query.test.ts',
            test: 'authorizes, asks the source outside the snapshot, maps and returns its status',
          },
        ],
      },
      {
        id: 'remote-source',
        lane: 'records',
        title: 'Source',
        summary:
          "The system of record answers under the caller's credential, or a permitted service account.",
        doc: 'systems-of-record#credentials-and-paging',
        sources: ['packages/integration/src'],
        tests: [
          {
            file: 'packages/integration/test/remote-source.test.ts',
            test: 'acts with the caller credential first, then a permitted service account',
          },
        ],
      },
      {
        id: 'remote-result',
        lane: 'surfaces',
        title: 'Result',
        summary:
          'The caller receives the rows with the source status and fetch time; nothing is stored, and an unreachable source is a status.',
        doc: 'systems-of-record#failures-and-adoption',
        sources: ['packages/runtime/src'],
        tests: [
          {
            file: 'packages/runtime/test/remote-query.test.ts',
            test: 'an unreachable source is a status, and provider error text never reaches the caller',
          },
        ],
      },
    ],
  },
];

/** The effect phases from `packages/runtime/src/effect-phase.ts` and the outbox transitions. */
export const phaseSource = 'packages/runtime/src/effect-phase.ts';
export const phaseTransitions: ReadonlyArray<readonly [from: string, to: string, via: string]> = [
  ['queued', 'claimed', 'claim'],
  ['retrying', 'claimed', 'claim'],
  ['upstream', 'claimed', 'claim'],
  ['claimed', 'retrying', 'attempt'],
  ['claimed', 'upstream', 'attempt'],
  ['claimed', 'held', 'attempt'],
  ['claimed', 'accepted', 'settle'],
  ['claimed', 'rejected', 'settle'],
  ['held', 'accepted', 'settle'],
  ['held', 'rejected', 'settle'],
  ['held', 'queued', 'release'],
  ['queued', 'cancelled', 'cancel'],
];

export interface Property {
  readonly property: string;
  readonly mechanism: string;
  readonly doc: DocReference;
  readonly tests: readonly TestReference[];
}

export const properties: readonly Property[] = [
  {
    property: 'A command commits and returns its receipt before the system of record is contacted.',
    mechanism: 'The outbox effect commits with the state; the dispatcher delivers afterwards.',
    doc: 'systems-of-record#outbox-and-settlement',
    tests: [
      {
        file: 'packages/integration/test/dispatcher.test.ts',
        test: 'delivers outside the transaction and settles through the domain command',
      },
      {
        file: 'examples/quality-inspection/domain.test.ts',
        test: 'an unavailable SoR leaves captured data committed and visibly retrying',
      },
    ],
  },
  {
    property: 'A scan submits the same command a button would, without a model turn.',
    mechanism: 'The scan router maps a decoded scan to a capability by GS1 AI or pattern.',
    doc: 'point-of-work-input#scan-routing',
    tests: [
      {
        file: 'packages/devices/test/scanner.test.ts',
        test: 'routes match GS1 AIs and patterns in order',
      },
    ],
  },
  {
    property:
      'Every capability is reachable without the screens, with the same validation, authorization and results.',
    mechanism: 'HTTP, MCP and the CLI are generated from the catalog and call one handler.',
    doc: 'architecture#surfaces-and-identity',
    tests: [
      {
        file: 'examples/project-tasks/test/transport-conformance.test.ts',
        test: 'direct, HTTP, CLI subprocess and MCP protocol share scoped results, errors and idempotent commits',
      },
    ],
  },
  {
    property: 'An undeclared or unbound destination is refused and recorded.',
    mechanism:
      'The egress guard is the network port; the deployment policy binds each destination.',
    doc: 'security-and-compliance#egress-guard',
    tests: [
      {
        file: 'plugins/network/test/guard.test.ts',
        test: 'undeclared, unbound, disabled and off-origin requests are refused and recorded',
      },
    ],
  },
  {
    property: 'A child process runs only when declared and bound, and a pinned digest must match.',
    mechanism: 'The process port starts bound executables with their configured variables only.',
    doc: 'hardware-drivers#process-binding',
    tests: [
      {
        file: 'plugins/process/test/process.test.ts',
        test: 'a pinned executable must match its digest before it runs',
      },
    ],
  },
  {
    property: 'A delivery whose outcome is unknown is held for a person and never retried.',
    mechanism: 'The held phase waits for a settle or release reconciliation command.',
    doc: 'systems-of-record#held-effects',
    tests: [
      {
        file: 'packages/integration/test/held.test.ts',
        test: 'an interrupted procedure is held, skipped by delivery and resolved by reconciliation',
      },
    ],
  },
  {
    property: 'A workstation application is not driven while the operator holds the seat.',
    mechanism: 'The workstation controller checks the bridge mode, hazard class and seat.',
    doc: 'operator-workstations#seat',
    tests: [
      {
        file: 'workstations/screen-bridge/test/controller.test.ts',
        test: 'monitor-only, assist for hazardous procedures, and an operator seat block without acting',
      },
      {
        file: 'workstations/screen-bridge/test/controller.test.ts',
        test: 'operator takeover mid-procedure holds the effect until a person reconciles it',
      },
    ],
  },
  {
    property: "An agent's approval request changes records only when a person approves it.",
    mechanism: "Approval runs the command once, as the approver, within the approver's grant.",
    doc: 'agents#approval-requests',
    tests: [
      {
        file: 'packages/runtime/test/approval.test.ts',
        test: 'an agent requests approval and a person approves: the command runs as the approver, once',
      },
    ],
  },
  {
    property: 'A site keeps committing and delivering while the fleet is unreachable.',
    mechanism: 'The fleet agent reports outbound only and queues its reports.',
    doc: 'hosting#fleet-agent',
    tests: [
      {
        file: 'plugins/fleet-agent/test/fleet-agent.test.ts',
        test: 'while the fleet is unreachable the site commits, and the next report shows the backlog',
      },
    ],
  },
  {
    property: 'A site bundle with a changed file is refused before install.',
    mechanism: 'The bundle is signed with Ed25519 and lists a digest for every file.',
    doc: 'security-and-compliance#compliance-bundle',
    tests: [
      {
        file: 'packages/bundle/test/bundle.test.ts',
        test: 'a tampered file, an added file, a changed manifest or an unknown key is refused',
      },
    ],
  },
];

export interface PortEntry {
  /** The key in `HostPorts`. */
  readonly port: string;
  readonly title: string;
  readonly fallback: string;
  readonly providers: ReadonlyArray<{ readonly plugin: string; readonly source: string }>;
}

/** The kernel's ports. The key set must equal `defaultPorts()` plus the optional `eventLog`. */
export const ports: readonly PortEntry[] = [
  {
    port: 'network',
    title: 'Network',
    fallback: 'Refuses every destination',
    providers: [
      { plugin: 'network', source: 'plugins/network/src/open.ts' },
      { plugin: 'hub-link', source: 'plugins/hub-link/src/plugin.ts' },
    ],
  },
  {
    port: 'ingress',
    title: 'Ingress',
    fallback: "The host platform's own listener: loopback on the Bun platform",
    providers: [{ plugin: 'network', source: 'plugins/network/src/open.ts' }],
  },
  {
    port: 'identity',
    title: 'Identity',
    fallback: 'Admits the trusted local owner',
    providers: [{ plugin: 'site', source: 'plugins/site/src/open.ts' }],
  },
  {
    port: 'eventLog',
    title: 'Audit log',
    fallback: 'No log',
    providers: [{ plugin: 'audit', source: 'plugins/audit/src/open.ts' }],
  },
  {
    port: 'shell',
    title: 'Shell',
    fallback: 'No OS integration',
    providers: [{ plugin: 'os', source: 'plugins/os/src/open.ts' }],
  },
  {
    port: 'processes',
    title: 'Processes',
    fallback: 'Refuses every child process',
    providers: [{ plugin: 'process', source: 'plugins/process/src/open.ts' }],
  },
  {
    port: 'folders',
    title: 'Folders',
    fallback: 'No exchange folders',
    providers: [{ plugin: 'site', source: 'plugins/site/src/open.ts' }],
  },
];

/** The layer import rules that `scripts/check-boundaries.ts` enforces. */
export const boundarySource = 'scripts/check-boundaries.ts';
export const boundaryRules: readonly string[] = [
  'The framework imports no starter, example or plugin code.',
  'A plugin imports no starter or example code.',
  'The starter imports no plugin or example code.',
  'An example imports no starter code.',
  'Nothing but a driver SDK imports a driver SDK, and an SDK imports no starter or example code.',
];

export interface ExampleRoute {
  readonly input: string;
  readonly record: string;
  readonly sources: readonly string[];
}

/** What each example takes in and which system of record it delivers to. */
export const exampleRoutes: Readonly<Record<string, ExampleRoute>> = {
  'quality-inspection': {
    input: 'Keyboard and wedge-scanner capture, and a serial gauge driver that only observes.',
    record: 'A fake quality system over HTTP, with outbox delivery and inbound sync of lots.',
    sources: ['examples/quality-inspection/fake-sor.ts', 'examples/quality-inspection/drivers'],
  },
  'line-station': {
    input:
      "A workstation application's screen through an observer, scanners, and an automation driver.",
    record:
      'A homebrew MES for orders and stops, and the workstation application through its screen.',
    sources: [
      'examples/line-station/fake-mes.ts',
      'examples/line-station/fake-hmi',
      'examples/line-station/drivers',
    ],
  },
  receiving: {
    input: 'Counts on the receiving screen and advance shipping notices from an inbox folder.',
    record: 'An ERP reached only through exchange folders, settled from receipt files.',
    sources: ['examples/receiving/erp-port.ts'],
  },
  'crm-capture': {
    input: "A remote query of the CRM with the caller's access, then adoption of accounts.",
    record: 'A fake CRM, with adoption through the outbox and updates from its feed.',
    sources: ['examples/crm-capture/fake-crm.ts'],
  },
  'asset-survey': {
    input: 'Nameplate photos from paired phones, read by an extractor or a vision model.',
    record: 'A fake EAM that files the reviewed assets.',
    sources: ['examples/asset-survey/connectors/fake-eam.ts'],
  },
  'asset-survey-field': {
    input: 'Camera photos and scans on a phone, captured offline.',
    record: 'The asset-survey hub, reached through the peer connector.',
    sources: ['examples/asset-survey-field/ui-native/capture.tsx'],
  },
  'project-tasks': {
    input: 'Screens, OS links, the share target and launcher shortcuts.',
    record: 'None; a notification target only.',
    sources: ['examples/project-tasks/os.ts'],
  },
  fleet: {
    input: 'Reports and audit events from enrolled sites.',
    record: 'None; the fleet keeps its own records.',
    sources: ['examples/fleet/domain.ts'],
  },
};
