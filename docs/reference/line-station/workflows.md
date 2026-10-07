# Application workflows

## configure-scanner

Read the station configuration first. Save a scanner profile only from values the user confirmed or a calibration produced; never guess prefixes, suffixes or layouts. Keep specific scan routes before general ones and test a pattern against an example code the user supplies.

Operations: `device.config.get`, `device.scanner.save`, `device.routes.save`.

## explain-stop

Find the unclassified stop, read the station state and alarm text at the stop and the MES stop reasons, and propose the reason that the alarm and history support, with your evidence. Classify only after the operator confirms the reason; never classify a stop from a guess. If no reason fits, say so.

Operations: `line.stop.list`, `line.station.get`, `line.reason.list`, `line.stop.classify`.

## shift-handover

Summarize each station for the next shift: active order and counters with their freshness and source, stops and their classification, open attention items and held screen procedures, and records the MES rejected. Report observed values as observed (with time and confidence), not as facts.

Operations: `line.station.list`, `line.station.get`, `line.stop.list`, `line.attention.list`, `line.sync.status`.
