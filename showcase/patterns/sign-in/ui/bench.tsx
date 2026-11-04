import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOperatorSession } from '@tortoise/workstation-sign-in/plugin-screens';
import { requestOperations, type TestRequestRecord } from '@tortoise/pattern-base/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useScanner } from '@/hooks/use-scanner';

/** Sample labels at the bench, such as OS-24-0417. */
const sampleRoutes = [{ intent: 'sample', pattern: '^(OS-\\d{2}-\\d{4})$' }];
const refusal = (error: unknown) =>
  (error as { code?: string }).code === 'FORBIDDEN'
    ? 'You may not submit test requests.'
    : error instanceof Error
      ? error.message
      : String(error);

/**
 * The bench while an operator is signed in: submit a test request for a scanned sample and
 * read the latest requests. Every query and command goes through the operator's own client, so
 * the request records the operator as its requester, and the test requests policy refuses a
 * viewer's submission.
 */
export function BenchWork() {
  const { client, live } = useOperatorSession();
  const [sample, setSample] = useState('');
  const [transformer, setTransformer] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string>();
  const [submitted, setSubmitted] = useState<string>();
  useScanner({ routes: sampleRoutes, onRoute: (routed) => setSample(routed.value) });
  const requests = useQuery(live.liveQueryOptions(requestOperations.requestList, { limit: 10 }));
  const items = ((requests.data as { items?: TestRequestRecord[] } | undefined)?.items ??
    []) as TestRequestRecord[];

  return (
    <div className="grid gap-(--operator-gap) lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Submit a test request</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              setError(undefined);
              setSubmitted(undefined);
              void client
                .command(requestOperations.requestSubmit, { sample, transformer, description })
                .then(() => {
                  setSubmitted(sample);
                  setSample('');
                  setTransformer('');
                  setDescription('');
                })
                .catch((failure) => setError(refusal(failure)));
            }}
          >
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {submitted && (
              <Alert>
                <AlertDescription>Submitted {submitted}.</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1">
              <Label htmlFor="bench-sample">Sample</Label>
              <Input
                id="bench-sample"
                value={sample}
                onChange={(event) => setSample(event.target.value)}
                placeholder="Scan the sample label"
                maxLength={64}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bench-transformer">Transformer</Label>
              <Input
                id="bench-transformer"
                value={transformer}
                onChange={(event) => setTransformer(event.target.value)}
                placeholder="TR-40517"
                maxLength={64}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bench-description">What to test</Label>
              <Input
                id="bench-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Breakdown voltage before re-energizing"
                required
              />
            </div>
            <Button type="submit">Submit</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Latest test requests</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sample</TableHead>
                <TableHead>Transformer</TableHead>
                <TableHead>Test method</TableHead>
                <TableHead>Submitted by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>{request.sample}</TableCell>
                  <TableCell>{request.transformer}</TableCell>
                  <TableCell>{request.method || '—'}</TableCell>
                  <TableCell>{request.requester}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
