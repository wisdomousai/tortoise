import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

/** Back link shared by the station sub-screens. */
export function StationBackLink({ station }: { station: string }) {
  const navigate = useNavigate();
  return (
    <Button
      variant="ghost"
      onClick={() => void navigate({ to: '/station/$stationId', params: { stationId: station } })}
    >
      ← Station
    </Button>
  );
}
