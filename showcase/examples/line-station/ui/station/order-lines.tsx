import { reading, shown, type Station } from './format';

/** The recipe the station screen shows, as last read; announced when it changes. */
export function RecipeLine({ station }: { station: Station }) {
  return (
    <div role="status" className="text-[0.8em] text-muted-foreground">
      Recipe {shown(reading(station, 'recipe'))} on the station screen
    </div>
  );
}

export function OrderLine({ station }: { station: Station }) {
  if (!station.order) return null;
  return (
    <div className="text-muted-foreground">
      {station.order.id} · {station.order.materialText} · {station.order.recipe}
    </div>
  );
}
