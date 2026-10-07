# Application workflows

## project-planning

Create a project from the brief, add concrete tasks, inspect the scoped task list, and update each task status as work progresses.

Operations: `project.create`, `task.create`, `task.list`, `task.set-status`.

## review-security-posture

Start with the posture. For any check that is not passing, list the matching audit events (for example kinds egress.denied, command.denied or posture.checked) and verify the chain before drawing conclusions. Report destinations by ID and state; never infer that an unbound destination was reached.

Operations: `assurance.posture.get`, `assurance.events.list`, `assurance.log.verify`.
