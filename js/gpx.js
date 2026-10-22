// GPX 1.1 export for trips.
import { esc } from './util.js';

export function tripToGpx(trip) {
  const pts = trip.points
    .map(([lat, lng, ts, acc, spd]) => {
      const ext = spd != null ? `<extensions><speed>${spd}</speed></extensions>` : '';
      return `      <trkpt lat="${lat}" lon="${lng}"><time>${new Date(ts).toISOString()}</time>${ext}</trkpt>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Boat Navigator" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(trip.name)}</name><time>${new Date(trip.startedAt).toISOString()}</time></metadata>
  <trk>
    <name>${esc(trip.name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

export function downloadGpx(trip) {
  const blob = new Blob([tripToGpx(trip)], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (trip.name.replace(/[^\w฀-๿-]+/g, '_') || 'trip') + '.gpx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
