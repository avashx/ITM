/**
 * Small GeoJSON helpers used by the seed scripts and (potentially) ingestion:
 * centroid, bbox, point-in-polygon (ray casting), and random-point-in-feature
 * (rejection sampling). Works with Polygon and MultiPolygon features.
 * Coordinates follow GeoJSON order: [lng, lat].
 */

/** Outer rings of a feature as an array of [[lng,lat], ...] rings. */
function outerRings(feature) {
  const g = feature.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates[0]];
  if (g.type === 'MultiPolygon') return g.coordinates.map((p) => p[0]);
  return [];
}

/** Ray-casting point-in-ring test. */
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInFeature(lng, lat, feature) {
  return outerRings(feature).some((ring) => pointInRing(lng, lat, ring));
}

/** Bounding box [minLng, minLat, maxLng, maxLat] over all outer rings. */
function bbox(feature) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const ring of outerRings(feature)) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

/** Simple vertex-average centroid (adequate for label points / fallbacks). */
function centroid(feature) {
  let sx = 0, sy = 0, n = 0;
  for (const ring of outerRings(feature)) {
    for (const [lng, lat] of ring) {
      sx += lng;
      sy += lat;
      n++;
    }
  }
  return n ? { lng: sx / n, lat: sy / n } : null;
}

/**
 * Random point inside a feature via rejection sampling on its bbox.
 * Falls back to the centroid after `maxTries`.
 * @param {function():number} rng 0..1 random source (injectable for seeding)
 */
function randomPointIn(feature, rng = Math.random, maxTries = 40) {
  const [minLng, minLat, maxLng, maxLat] = bbox(feature);
  for (let i = 0; i < maxTries; i++) {
    const lng = minLng + rng() * (maxLng - minLng);
    const lat = minLat + rng() * (maxLat - minLat);
    if (pointInFeature(lng, lat, feature)) return { lng, lat };
  }
  return centroid(feature);
}

/** Find the first feature of a collection containing the point. */
function featureContaining(lng, lat, featureCollection) {
  return featureCollection.features.find((f) => pointInFeature(lng, lat, f)) || null;
}

module.exports = { outerRings, pointInFeature, bbox, centroid, randomPointIn, featureContaining };
