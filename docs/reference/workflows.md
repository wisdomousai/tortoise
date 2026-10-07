# Application workflows

## configure-scanner

Read the station configuration first. Save a scanner profile only from values the user confirmed or a calibration produced; never guess prefixes, suffixes or layouts. Keep specific scan routes before general ones and test a pattern against an example code the user supplies.

Operations: `device.config.get`, `device.scanner.save`, `device.routes.save`.

## explain-stop

Find the unclassified stop, read the station state and alarm text at the stop and the MES stop reasons, and propose the reason that the alarm and history support, with your evidence. Classify only after the operator confirms the reason; never classify a stop from a guess. If no reason fits, say so.

Operations: `line.stop.list`, `line.station.get`, `line.reason.list`, `line.stop.classify`.

## inspect-lot

Find the open lot, read its characteristics and limits, then record each measurement for the sample named by the worklist. For an instrument export, map rows to characteristics and samples and submit them with record-batch in one commit; never invent values that are not in the source. Use the measurement time from the source as occurredAt. Report out-of-tolerance results and record a defect only when the source states one. Leave the usage decision to a supervisor.

Operations: `inspection.lot.list`, `inspection.worklist`, `inspection.lot.get`, `inspection.result.record-batch`, `inspection.result.record`, `inspection.defect.record`.

## project-planning

Create a project from the brief, add concrete tasks, inspect the scoped task list, and update each task status as work progresses.

Operations: `project.create`, `task.create`, `task.list`, `task.set-status`.

## review-security-posture

Start with the posture. For any check that is not passing, list the matching audit events (for example kinds egress.denied, command.denied or posture.checked) and verify the chain before drawing conclusions. Report destinations by ID and state; never infer that an unbound destination was reached.

Operations: `assurance.posture.get`, `assurance.events.list`, `assurance.log.verify`.

## shift-handover

Summarize each station for the next shift: active order and counters with their freshness and source, stops and their classification, open attention items and held screen procedures, and records the MES rejected. Report observed values as observed (with time and confidence), not as facts.

Operations: `line.station.list`, `line.station.get`, `line.stop.list`, `line.attention.list`, `line.sync.status`.

## triage-rejections

Read rejected records from sync status, inspect the lot and the rejection reason, and explain each one. Correct a result only when the reason identifies a clear entry error and the correct value is known; supply that reason. Otherwise ask the user. A correction is forwarded again and may itself be rejected.

Operations: `inspection.sync.status`, `inspection.lot.get`, `inspection.result.correct`.
