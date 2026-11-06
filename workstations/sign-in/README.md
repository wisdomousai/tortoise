# @tortoise/workstation-sign-in

`@tortoise/workstation-sign-in` issues operator sessions at shared terminals after badge-and-PIN authentication. The terminal credential has access to sign-in operations; subsequent application commands use the signed-in person's operator session.

Sign-in attempts run as commands. Audit fields describe the attempt without disclosing the badge value or PIN. Session expiry and revocation are checked by the host on later requests.

## References

[sign-in-at-a-terminal](skills/sign-in-at-a-terminal/SKILL.md)

[Operator workstations](../../docs/operator-workstations.md)
