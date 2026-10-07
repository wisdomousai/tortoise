# 002 — Logical CQRS with atomic receipts

Accepted: commands and queries share one transactional authority but expose different execution paths. Commands commit feature changes, revisions, receipt and journal together. Queries return authorized data and a journal cursor from a consistent snapshot.

The reference persistence serializes a JSON snapshot. Storage adapters may use normalized tables and transaction-bound repositories without changing the interaction contract. External model/network calls stay outside business transactions. External preparation can precede a command; external effects require their own delivery and outcome handling. Idempotency and optimistic revisions solve different problems and are both retained.

The atomic receipt establishes a commit in this authority. It does not establish acceptance by a separate system of record. The proposed [task/workflow integration](../task-workflow-pattern.md) uses a local capture and durable intent, followed by external dispatch and a separately committed result. Such integration must specify idempotency, uncertain outcomes and reconciliation; the current runtime does not implement a distributed transaction.
