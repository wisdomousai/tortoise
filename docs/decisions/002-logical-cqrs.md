# 002 — Logical CQRS with atomic receipts

Accepted: commands and queries share one transactional authority but expose different execution paths. Commands commit feature changes, revisions, receipt and journal together. Queries return authorized data and a journal cursor from a consistent snapshot.

The reference persistence serializes a JSON snapshot. Storage adapters may use normalized tables and transaction-bound repositories without changing the interaction contract. External model/network calls happen before a tool invocation, outside business transactions. Idempotency and optimistic revisions solve different problems and are both retained.
