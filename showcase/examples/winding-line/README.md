# Winding-line workstation

An operator runs a winder that makes coils for control transformers. The workstation application owns the machine state, recipe and counters; a separate MES owns orders and stop reasons. This application observes the workstation through the screen bridge, helps the operator classify stops and confirm counts, and delivers those records to the MES. A fake HMI and a fake MES stand in during development; an optional driver route uses an automation interface instead of the screen.

```sh
cd showcase/examples/winding-line
bun run dev:web
```

## What to try

- Watch the fake HMI (port 4610) and classify a stop or confirm a count in the app (port 4323).
- Without a recognition model or worker configured, the demo runs in simulator mode and reads the simulator's ground truth, so it does not prove visual recognition.
- Set `STATION_HMI_URL` to bridge another HMI; `STATION_ID`, `STATION_PROFILE` and `STATION_OBSERVE_MS` select the station, profile and interval.
- After a profile change, run `bun run station:golden`.

## References

- [Operator workstations](../../../docs/operator-workstations.md)
- Primitives: [observation](../../../docs/primitives.md#observation)
- Real parts and stand-ins: [implementation status](../../../docs/implementation-status.md#operator-workstation-bridge)
- `bun test showcase/examples/winding-line`, `bunx playwright test showcase/examples/winding-line/e2e`
