/**
 * Grievance analytics (Module 2). Queries pull lean, projected documents
 * filtered on indexed fields, then group in process. At Delhi PGMS-like
 * volumes bounded by date windows this stays well under a few tens of
 * milliseconds, and it runs identically on MongoDB, Atlas, DocumentDB and
 * FerretDB (no reliance on engine-specific aggregation stages). If volumes
 * grow past ~10^6 docs per window, port these reducers to aggregation
 * pipelines on Atlas.
 */
const { Grievance } = require('../../models');
const { evaluateBreaches } = require('./sla');
const { lastNDayBuckets } = require('../../utils/dates');

/** Shared filter builder for list/stat endpoints. */
function buildFilter(q = {}) {
  const filter = {};
  if (q.department) filter.department = q.department;
  if (q.category) filter.category = q.category;
  if (q.status) filter.status = q.status;
  if (q.priority) filter.priority = q.priority;
  if (q.district) filter['location.district'] = q.district;
  if (q.ward) filter['location.ward'] = q.ward;
  if (q.days) {
    const days = Math.min(parseInt(q.days, 10) || 30, 365);
    filter.dayBucket = { $gte: lastNDayBuckets(days)[0] };
  } else if (q.from || q.to) {
    filter.dayBucket = {};
    if (q.from) filter.dayBucket.$gte = String(q.from);
    if (q.to) filter.dayBucket.$lte = String(q.to);
  }
  return filter;
}

/** Headline numbers for the analytics page. */
async function summary(q = {}) {
  const filter = buildFilter(q);
  const docs = await Grievance.find(filter)
    .select('status priority resolutionHours sla firstResponseAt resolvedAt registeredAt')
    .lean();

  const now = new Date();
  const out = {
    total: docs.length,
    byStatus: {},
    byPriority: {},
    slaResponseBreaches: 0,
    slaResolutionBreaches: 0,
    avgResolutionHours: null,
    medianResolutionHours: null,
  };
  const resHours = [];
  for (const g of docs) {
    out.byStatus[g.status] = (out.byStatus[g.status] || 0) + 1;
    out.byPriority[g.priority] = (out.byPriority[g.priority] || 0) + 1;
    const b = evaluateBreaches(g, now);
    if (b.responseBreached) out.slaResponseBreaches++;
    if (b.resolutionBreached) out.slaResolutionBreaches++;
    if (typeof g.resolutionHours === 'number') resHours.push(g.resolutionHours);
  }
  if (resHours.length) {
    resHours.sort((a, b) => a - b);
    const sum = resHours.reduce((s, v) => s + v, 0);
    out.avgResolutionHours = Math.round((sum / resHours.length) * 10) / 10;
    out.medianResolutionHours = resHours[Math.floor(resHours.length / 2)];
  }
  out.slaBreachRate = out.total
    ? Math.round((out.slaResolutionBreaches / out.total) * 1000) / 10
    : 0;
  return out;
}

/** Department-wise table: volume, open, SLA breach %, avg resolution days. */
async function byDepartment(q = {}) {
  const filter = buildFilter(q);
  const docs = await Grievance.find(filter)
    .select('department status resolutionHours sla firstResponseAt resolvedAt')
    .lean();

  const now = new Date();
  const map = new Map();
  for (const g of docs) {
    let d = map.get(g.department);
    if (!d) {
      d = { department: g.department, total: 0, open: 0, resolved: 0, breaches: 0, resSum: 0, resN: 0 };
      map.set(g.department, d);
    }
    d.total++;
    if (g.status === 'resolved') d.resolved++;
    else if (g.status !== 'rejected') d.open++;
    if (evaluateBreaches(g, now).resolutionBreached) d.breaches++;
    if (typeof g.resolutionHours === 'number') {
      d.resSum += g.resolutionHours;
      d.resN++;
    }
  }
  return [...map.values()]
    .map((d) => ({
      department: d.department,
      total: d.total,
      open: d.open,
      resolved: d.resolved,
      slaBreachPct: d.total ? Math.round((d.breaches / d.total) * 1000) / 10 : 0,
      avgResolutionDays: d.resN ? Math.round((d.resSum / d.resN / 24) * 10) / 10 : null,
    }))
    .sort((a, b) => b.total - a.total);
}

/** Daily registration counts (optionally per department) for trend charts. */
async function trends(q = {}) {
  const days = Math.min(parseInt(q.days, 10) || 30, 365);
  const buckets = lastNDayBuckets(days);
  const filter = buildFilter({ ...q, days });
  const docs = await Grievance.find(filter).select('dayBucket department').lean();

  const perDay = Object.fromEntries(buckets.map((b) => [b, 0]));
  const perDeptDay = {};
  for (const g of docs) {
    if (perDay[g.dayBucket] === undefined) continue;
    perDay[g.dayBucket]++;
    if (!perDeptDay[g.department]) {
      perDeptDay[g.department] = Object.fromEntries(buckets.map((b) => [b, 0]));
    }
    perDeptDay[g.department][g.dayBucket]++;
  }
  // Keep the 6 highest-volume departments as separate series for the chart.
  const topDepts = Object.entries(perDeptDay)
    .map(([dept, m]) => [dept, Object.values(m).reduce((s, v) => s + v, 0)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([dept]) => dept);

  return {
    days: buckets,
    total: buckets.map((b) => perDay[b]),
    departments: topDepts.map((dept) => ({
      department: dept,
      counts: buckets.map((b) => perDeptDay[dept][b]),
    })),
  };
}

/** Top categories overall (for the bar chart). */
async function topCategories(q = {}) {
  const filter = buildFilter(q);
  const docs = await Grievance.find(filter).select('department category').lean();
  const map = new Map();
  for (const g of docs) {
    const key = `${g.category}||${g.department}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => {
      const [category, department] = key.split('||');
      return { category, department, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, parseInt(q.limit, 10) || 15);
}

/** Points for the Leaflet heat layer: [lat, lng, weight]. */
async function heatmapPoints(q = {}) {
  const filter = buildFilter(q);
  filter['location.lat'] = { $exists: true };
  const docs = await Grievance.find(filter)
    .select('location.lat location.lng priority')
    .limit(20000)
    .lean();
  return docs
    .filter((g) => g.location && typeof g.location.lat === 'number')
    .map((g) => [
      g.location.lat,
      g.location.lng,
      g.priority === 'sos' ? 1.0 : g.priority === 'urgent' ? 0.7 : 0.4,
    ]);
}

/** Complaint counts keyed by district or ward name - joined client-side onto the vendored GeoJSON for the choropleth layer. */
async function choropleth(q = {}) {
  const level = q.level === 'ward' ? 'ward' : 'district';
  const field = level === 'ward' ? 'location.ward' : 'location.district';
  const filter = buildFilter(q);
  const docs = await Grievance.find(filter).select(field).lean();
  const counts = {};
  for (const g of docs) {
    const key = level === 'ward' ? g.location && g.location.ward : g.location && g.location.district;
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return { level, counts };
}

/** Marker list (bounded) for the cluster layer with popup details. */
async function points(q = {}) {
  const filter = buildFilter(q);
  filter['location.lat'] = { $exists: true };
  return Grievance.find(filter)
    .select('grievanceId department category status priority registeredAt location description')
    .sort({ registeredAt: -1 })
    .limit(Math.min(parseInt(q.limit, 10) || 2000, 5000))
    .lean();
}

module.exports = {
  buildFilter,
  summary,
  byDepartment,
  trends,
  topCategories,
  heatmapPoints,
  choropleth,
  points,
};
