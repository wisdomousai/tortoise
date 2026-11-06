# @tortoise/connector-files

`@tortoise/connector-files` implements a target port over configured exchange folders. Delivery writes a hidden partial file and renames it into place. The external reader must ignore dot-prefixed files and preserve delivery evidence until it has written a receipt or archived the delivery.

Lookup checks the receipt location before the delivery folders. The dispatcher uses that evidence before resending an effect. A malformed receipt produces an uncertain outcome requiring reconciliation. An inbox supplies batches for inbound sync through the configured parser. The XML parser rejects DOCTYPE declarations and unsupported document structure.

## References

[connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md)

[deploy-an-application](../deployment/skills/deploy-an-application/SKILL.md)

`bun test plugins/connector-files`
