import type { ExportOptions } from '../exporters';
import type { RuleSet } from '../rules';
import { defaults, document, familyOf, serviceArgs } from './common';

export function networkPolicy(rules: RuleSet, options: ExportOptions): string {
  const d = defaults(rules, options);
  const cidr = (address: string) =>
    address.includes('/') ? address : `${address}/${familyOf(address) === 4 ? 32 : 128}`;
  const dns = rules.dns.resolvers.length
    ? [
        {
          to: rules.dns.resolvers.map((resolver) => ({ ipBlock: { cidr: cidr(resolver) } })),
          ports: [
            { protocol: 'UDP', port: 53 },
            { protocol: 'TCP', port: 53 },
          ],
        },
      ]
    : rules.dns.needed
      ? [
          {
            to: [
              {
                namespaceSelector: {
                  matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' },
                },
                podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } },
              },
            ],
            ports: [
              { protocol: 'UDP', port: 53 },
              { protocol: 'TCP', port: 53 },
            ],
          },
        ]
      : [];
  return document(rules, 'k8s-networkpolicy', {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name: `${d.name}-network`, labels: { 'app.kubernetes.io/name': d.name } },
    spec: {
      podSelector: { matchLabels: { 'app.kubernetes.io/name': d.name } },
      policyTypes: ['Ingress', 'Egress'],
      ingress:
        rules.ingress.listen !== 'loopback' && rules.ingress.port
          ? [{ ports: [{ protocol: 'TCP', port: rules.ingress.port }] }]
          : [],
      egress: [
        ...dns,
        ...rules.allow.map((rule) => ({
          to: rule.addresses.map((address) => ({ ipBlock: { cidr: cidr(address) } })),
          ports: [{ protocol: rule.transport.toUpperCase(), port: rule.port }],
        })),
      ],
    },
  });
}

export function pod(rules: RuleSet, options: ExportOptions): string {
  const d = defaults(rules, options);
  return document(rules, 'k8s-pod', {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: d.name, labels: { 'app.kubernetes.io/name': d.name } },
    spec: {
      automountServiceAccountToken: false,
      securityContext: {
        runAsNonRoot: true,
        runAsUser: d.uid,
        runAsGroup: d.uid,
        fsGroup: d.uid,
        seccompProfile: { type: 'RuntimeDefault' },
      },
      containers: [
        {
          name: d.name,
          image: d.image,
          args: serviceArgs(d),
          securityContext: {
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            privileged: false,
            capabilities: { drop: ['ALL'] },
          },
          volumeMounts: [
            { name: 'workspace', mountPath: d.workspace },
            { name: 'audit', mountPath: d.auditLog },
            {
              name: 'deployment-policy',
              mountPath: d.deploymentPolicy,
              subPath: 'deployment-policy.json',
              readOnly: true,
            },
            { name: 'tmp', mountPath: '/tmp' },
          ],
        },
      ],
      volumes: [
        { name: 'workspace', persistentVolumeClaim: { claimName: `${d.name}-workspace` } },
        { name: 'audit', persistentVolumeClaim: { claimName: `${d.name}-audit` } },
        { name: 'deployment-policy', configMap: { name: `${d.name}-deployment-policy` } },
        { name: 'tmp', emptyDir: { medium: 'Memory', sizeLimit: '64Mi' } },
      ],
    },
  });
}
