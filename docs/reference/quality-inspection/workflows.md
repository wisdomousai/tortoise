# Application workflows

## inspect-lot

Find the open lot, read its characteristics and limits, then record each measurement for the sample named by the worklist. For an instrument export, map rows to characteristics and samples and submit them with record-batch in one commit; never invent values that are not in the source. Use the measurement time from the source as occurredAt. Report out-of-tolerance results and record a defect only when the source states one. Leave the usage decision to a supervisor.

Operations: `inspection.lot.list`, `inspection.worklist`, `inspection.lot.get`, `inspection.result.record-batch`, `inspection.result.record`, `inspection.defect.record`.

## review-security-posture

Start with the posture. For any check that is not passing, list the matching audit events (for example kinds egress.denied, command.denied or posture.checked) and verify the chain before drawing conclusions. Report destinations by ID and state; never infer that an unbound destination was reached.

Operations: `assurance.posture.get`, `assurance.events.list`, `assurance.log.verify`.

## triage-rejections

Read rejected records from sync status, inspect the lot and the rejection reason, and explain each one. Correct a result only when the reason identifies a clear entry error and the correct value is known; supply that reason. Otherwise ask the user. A correction is forwarded again and may itself be rejected.

Operations: `inspection.sync.status`, `inspection.lot.get`, `inspection.result.correct`.
