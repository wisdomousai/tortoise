# Winding-line workstation

This hypothetical winding-line application observes workstation software through a screen bridge and records operator-confirmed production information. Its MES port supplies orders and receives the captured results.

Development launches a fake HMI with a fake MES. The screen observer can use simulator ground truth or an explicitly configured recognizer. A separate driver route exercises a declared automation interface.

```sh
cd showcase/examples/winding-line
bun run dev:web
```

## What to try

Watch the fake HMI (port 4610) and classify a stop or confirm a count in the app (port 4323).

Without a recognition model or worker configured, the demo runs in simulator mode and reads the simulator's ground truth, so it does not prove visual recognition.

Set `STATION_HMI_URL` to bridge another HMI; `STATION_ID`, `STATION_PROFILE` and `STATION_OBSERVE_MS` select the station, profile and interval.

After a profile change, run `bun run station:golden`.

## References

[Operator workstations](../../../docs/operator-workstations.md)

Real parts and stand-ins: [implementation status](../../../docs/implementation-status.md#operator-workstation-bridge)

`bun test showcase/examples/winding-line`, `bunx playwright test showcase/examples/winding-line/e2e`
