import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOperatorSession } from '@agent-native/workstation-sign-in/plugin-screens';
import {
  requestOperations,
  type TestRequestRecord,
} from '@agent-native/pattern-lab-requests/contracts';
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

/** Specimen labels at the bench, such as B-1042-03. */
const specimenRoutes = [{ intent: 'specimen', pattern: '^(B-\\d{4}-\\d{2})$' }];
const refusal = (error: unknown) =>
  (error as { code?: string }).code === 'FORBIDDEN'
    ? 'You may not submit test requests.'
    : error instanceof Error
      ? error.message
      : String(error);

/**
 * The bench while an operator is signed in: submit a test request for a scanned specimen and
 * read the latest requests. Every query and command goes through the operator's own client, so
 * the request records the operator as its requester, and the lab requests policy refuses a
 * viewer's submission.
 */
export function BenchWork() {
  const { client, live } = useOperatorSession();
  const [specimen, setSpecimen] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string>();
  const [submitted, setSubmitted] = useState<string>();
  useScanner({ routes: specimenRoutes, onRoute: (routed) => setSpecimen(routed.value) });
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
                .command(requestOperations.requestSubmit, { specimen, description })
                .then(() => {
                  setSubmitted(specimen);
                  setSpecimen('');
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
              <Label htmlFor="bench-specimen">Specimen</Label>
              <Input
                id="bench-specimen"
                value={specimen}
                onChange={(event) => setSpecimen(event.target.value)}
                placeholder="Scan the specimen label"
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
                placeholder="Hardness of the heat-treated shaft"
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
                <TableHead>Specimen</TableHead>
                <TableHead>Test method</TableHead>
                <TableHead>Submitted by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>{request.specimen}</TableCell>
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
