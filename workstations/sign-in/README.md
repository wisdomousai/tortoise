# @tortoise/workstation-sign-in

Badge-and-PIN sign-in at a shared terminal. Each operator gets a short-lived session of their own; the terminal's session only signs people in. Each attempt is a recorded command with the badge ID, the terminal and whether the PIN matched; the audit log stores no badge value, PIN or token digest.

- Primitives: [Workstation sign-in](../../docs/primitives.md#workstation-sign-in), [Host plugin](../../docs/primitives.md#host-plugin).

## References

- [sign-in-at-a-terminal](skills/sign-in-at-a-terminal/SKILL.md)
- [Operator workstations](../../docs/operator-workstations.md)
