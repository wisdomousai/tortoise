import { Plug, ScanLine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { visible } from '@/components/scanner-calibration';
import { useScanner } from '@/hooks/use-scanner';

type Scanner = ReturnType<typeof useScanner>;
type LastScan = NonNullable<Scanner['last']>;

/** GS1 element strings as a table, each with its check result. */
function Gs1Elements({ gs1 }: { gs1: NonNullable<LastScan['scan']['gs1']> }) {
  return (
    <table className="w-full text-left">
      <tbody>
        {gs1.elements.map((element, index) => (
          <tr key={`${element.ai}-${index}`} className="border-t">
            <th scope="row" className="py-1 pr-4 font-mono">
              ({element.ai})
            </th>
            <td className="py-1 pr-4 text-muted-foreground">{element.title}</td>
            <td className="py-1 font-mono">
              {element.value}
              {element.issue && (
                <span className="ml-3 font-sans text-op-fault">{element.issue}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The last decoded scan: raw data with control characters shown, symbology, route and GS1. */
function ScanReadout({ last }: { last: LastScan }) {
  return (
    <div className="space-y-2 rounded-lg border-2 p-4">
      <p className="flex flex-wrap items-center gap-2">
        <ScanLine className="size-6" aria-hidden />
        <span className="font-mono text-(length:--operator-text-lg) break-all">
          {visible(last.scan.data)}
        </span>
        {last.scan.symbology && <Badge variant="outline">{last.scan.symbology}</Badge>}
        {last.scan.aimId && <Badge variant="outline">{last.scan.aimId}</Badge>}
        {last.routed && <Badge>{last.routed.intent}</Badge>}
      </p>
      {last.scan.gs1 && <Gs1Elements gs1={last.scan.gs1} />}
      {last.scan.gs1 && !last.scan.gs1.valid && (
        <p className="text-op-fault">{last.scan.gs1.error ?? 'A GS1 field failed its check.'}</p>
      )}
    </div>
  );
}

/** Connect a non-wedge source on a button press, as browsers require, and show what it read. */
function ScanTest({ scanner, wedge }: { scanner: Scanner; wedge: boolean }) {
  return (
    <>
      {!wedge && (
        <Button
          type="button"
          variant="outline"
          className="touch-operator h-(--operator-target) text-(length:--operator-text)"
          onClick={() => void scanner.connect()}
        >
          <Plug className="size-7" aria-hidden />
          {scanner.connected ? 'Reconnect scanner' : 'Connect scanner'}
        </Button>
      )}
      {scanner.error && <p className="text-op-fault">{scanner.error}</p>}
      {scanner.last ? (
        <ScanReadout last={scanner.last} />
      ) : (
        <p className="text-muted-foreground">No scan yet.</p>
      )}
    </>
  );
}

export { ScanTest };
