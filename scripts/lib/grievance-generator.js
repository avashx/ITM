/**
 * Synthetic grievance generator (clearly labelled: source='synthetic',
 * IDs prefixed SYN-). Produces realistic Delhi-shaped complaint data:
 *
 *  - categories/departments follow the PGMS-style taxonomy in
 *    data/reference/departments.json
 *  - every grievance is geolocated inside a REAL ward polygon from the
 *    vendored DataMeet ward map; district + assembly constituency are
 *    assigned by point-in-polygon against the real boundary files
 *  - weekly seasonality (Monday peak, Sunday trough) + Poisson noise
 *  - department-specific resolution behaviour so SLA analytics look right
 *  - optional "spikes": [{category, fromDayOffset, days, multiplier}] used by
 *    seed-demo to inject outage-correlated complaint surges for Module 3
 *
 * Descriptions are generated from keyword-bearing templates, so the keyword
 * classifier independently re-derives the department - the generator reports
 * the classifier agreement rate as a built-in sanity check.
 */
const fs = require('fs');
const path = require('path');
const { makeRng } = require('./rng');
const { randomPointIn, centroid, featureContaining } = require('../../src/utils/geo');
const { classify } = require('../../src/modules/grievance/classifier');
const { computeDeadlines, evaluateBreaches } = require('../../src/modules/grievance/sla');
const { dayBucket } = require('../../src/utils/dates');

const GEO_DIR = path.join(__dirname, '../../data/geo');

// dailyRate = expected complaints/day city-wide at scale=1.0
// resolveMeanDays drives resolution-time distributions (dept realism)
const PROFILES = [
  { cat: 'Water Supply', dept: 'Delhi Jal Board', rate: 20, resolve: 6, t: [
    'No water supply in {area} since two days, entire block affected',
    'Very low pressure water supply in {area}, tanker needed urgently',
    'Pipeline leak flooding the lane near {area} market, water being wasted',
    'Water not coming in mornings in {area}, boring also dry'] },
  { cat: 'Water Quality', dept: 'Delhi Jal Board', rate: 6, resolve: 8, t: [
    'Dirty water coming from taps in {area}, smells foul',
    'Contaminated muddy water supplied in {area} since last week',
    'Yellow water with bad smell in {area}, sewage mixed suspected'] },
  { cat: 'Sewerage', dept: 'Delhi Jal Board', rate: 10, resolve: 9, t: [
    'Sewer overflow on main road of {area}, unbearable situation',
    'Manhole cover missing near {area} school, very dangerous',
    'Sewer line blocked in {area}, dirty water entering houses'] },
  { cat: 'Water Billing', dept: 'Delhi Jal Board', rate: 7, resolve: 12, t: [
    'Received inflated water bill despite meter reading being low in {area}',
    'Water meter not read for months, arbitrary DJB bill issued in {area}',
    'Bill correction pending since long for KNO in {area}'] },
  { cat: 'Power Outage', dept: 'Power (DISCOMs)', rate: 16, resolve: 2, t: [
    'Frequent power cut in {area}, 4-5 hours daily without electricity',
    'Transformer sparking caused power failure in {area} since last night',
    'No electricity in {area} block C, complaint not attended'] },
  { cat: 'Power Billing', dept: 'Power (DISCOMs)', rate: 8, resolve: 10, t: [
    'Inflated electricity bill received, meter fast in {area}',
    'Electricity bill shows wrong unit reading for my CA number in {area}'] },
  { cat: 'Power Infrastructure', dept: 'Power (DISCOMs)', rate: 4, resolve: 7, t: [
    'Hanging loose wire from electric pole in {area}, risk of electric shock',
    'Electric pole tilted dangerously near {area} park'] },
  { cat: 'Garbage & Sanitation', dept: 'Municipal Corporation of Delhi', rate: 28, resolve: 5, t: [
    'Garbage not collected from dhalao in {area} for a week, stink everywhere',
    'Sweeping not done in {area} lanes, waste dumped on road corner',
    'Dustbin overflowing near {area} market, sanitation staff absent',
    'Malba and debris dumped on street in {area}, needs urgent cleaning'] },
  { cat: 'Property Tax', dept: 'Municipal Corporation of Delhi', rate: 5, resolve: 15, t: [
    'Property tax portal shows wrong UPIC details for my house in {area}',
    'Unable to generate property tax receipt after payment in {area}'] },
  { cat: 'Birth & Death Certificates', dept: 'Municipal Corporation of Delhi', rate: 6, resolve: 12, t: [
    'Birth certificate application pending for a month in {area} zone office',
    'Death certificate has name spelling error, correction not processed in {area}'] },
  { cat: 'Stray Animals & Vector Control', dept: 'Municipal Corporation of Delhi', rate: 9, resolve: 8, t: [
    'Stray dog menace in {area}, children scared, dog bite case reported',
    'No fogging done in {area} despite dengue cases rising',
    'Stray cattle blocking roads in {area} daily'] },
  { cat: 'Public Toilets & Parks', dept: 'Municipal Corporation of Delhi', rate: 5, resolve: 11, t: [
    'Public toilet in {area} market is filthy and without water',
    'Park maintenance ignored in {area}, broken swings and dry grass'] },
  { cat: 'Encroachment & Unauthorized Construction', dept: 'Municipal Corporation of Delhi', rate: 6, resolve: 20, t: [
    'Illegal construction ongoing on fourth floor in {area} without sanction',
    'Footpath occupied by encroachment near {area} metro station'] },
  { cat: 'Roads & Potholes', dept: 'Public Works Department', rate: 14, resolve: 14, t: [
    'Deep pothole on main road in {area} causing accidents daily',
    'Road broken and caved in near {area} crossing, needs repair',
    'Unfinished road construction abandoned in {area} for months'] },
  { cat: 'Streetlights', dept: 'Public Works Department', rate: 9, resolve: 9, t: [
    'Streetlight not working in {area} lane, dark street unsafe for women',
    'Half the street lights of {area} main road are off since weeks'] },
  { cat: 'Waterlogging & Drainage', dept: 'Public Works Department', rate: 10, resolve: 6, t: [
    'Severe waterlogging in {area} underpass after rain, traffic stuck',
    'Rain water accumulation in {area} colony, storm drain choked'] },
  { cat: 'Footpaths & Public Infrastructure', dept: 'Public Works Department', rate: 4, resolve: 16, t: [
    'Footpath broken near {area} bus stand, elderly cannot walk',
    'Foot over bridge railing damaged at {area}'] },
  { cat: 'Bus Services (DTC/Cluster)', dept: 'Transport Department', rate: 7, resolve: 7, t: [
    'DTC bus on route via {area} not stopping at the bus stop',
    'Bus frequency very poor in {area} during office hours',
    'Cluster bus breakdown daily near {area}, no marshal present'] },
  { cat: 'Licences & Registration', dept: 'Transport Department', rate: 8, resolve: 9, t: [
    'Driving licence renewal stuck in faceless service, no update for {area} applicant',
    'RC transfer application pending since two months, applied from {area}',
    'Learning licence slot not available on sarathi for {area} RTO'] },
  { cat: 'Permits & Enforcement', dept: 'Transport Department', rate: 4, resolve: 10, t: [
    'Auto refused to go by meter from {area}, overcharging rampant',
    'Wrong challan issued though PUC was valid, resident of {area}'] },
  { cat: 'Certificates (e-District)', dept: 'Revenue Department', rate: 10, resolve: 10, t: [
    'Income certificate application pending on e-district portal for {area} resident',
    'Caste certificate rejected without reason on edistrict, applied from {area}',
    'Domicile certificate not issued even after document verification in {area}',
    'EWS certificate urgently needed for admission, application stuck, {area}'] },
  { cat: 'Land Records & Registration', dept: 'Revenue Department', rate: 5, resolve: 18, t: [
    'Mutation of property pending at {area} tehsil since months',
    'Khasra khatauni record mismatch for {area} land, correction needed',
    'Sub registrar appointment for registry not available for {area}'] },
  { cat: 'Ration Card', dept: 'Food & Civil Supplies', rate: 9, resolve: 11, t: [
    'Ration card member addition pending on NFS portal for {area} family',
    'Ration card application rejected without reason in {area} circle',
    'Aadhaar seeding ration issue, name dropped from food security list in {area}'] },
  { cat: 'Fair Price Shops', dept: 'Food & Civil Supplies', rate: 5, resolve: 9, t: [
    'Fair price shop in {area} giving less ration than entitlement',
    'FPS dealer keeps ration shop closed most days in {area}'] },
  { cat: 'Hospitals & Dispensaries', dept: 'Health & Family Welfare', rate: 8, resolve: 6, t: [
    'Medicine not available at {area} mohalla clinic for a week',
    'OPD appointment not available at hospital near {area}, long queue',
    'Doctor absent at {area} dispensary during working hours'] },
  { cat: 'Public Health', dept: 'Health & Family Welfare', rate: 4, resolve: 8, t: [
    'Vaccination camp not held as scheduled in {area}',
    'Suspected food adulteration by vendor in {area} market'] },
  { cat: 'School Admissions', dept: 'Education (DoE)', rate: 5, resolve: 12, t: [
    'EWS admission draw result not honoured by school in {area}',
    'Nursery admission documents rejected unfairly in {area} school'] },
  { cat: 'School Infrastructure & Staff', dept: 'Education (DoE)', rate: 4, resolve: 15, t: [
    'No teacher for maths in {area} government school for months',
    'School toilet broken and classrooms overcrowded in {area}'] },
  { cat: 'Safety & Policing', dept: 'Delhi Police', rate: 10, resolve: 8, t: [
    'Chain snatching incidents rising in {area}, police patrolling absent',
    'FIR not registered at {area} police station despite complaint',
    'Late night noise and gambling in {area} park, PCR not responding'] },
  { cat: 'Traffic', dept: 'Delhi Police', rate: 8, resolve: 7, t: [
    'Traffic signal not working at {area} crossing since days',
    'Illegal parking blocking {area} main road daily, traffic jam'] },
  { cat: 'Slum & JJ Clusters', dept: 'Housing & Urban Shelter (DUSIB/DDA)', rate: 4, resolve: 20, t: [
    'Night shelter near {area} overcrowded and unhygienic',
    'JJ cluster in {area} lacks water and toilets, resettlement pending'] },
  { cat: 'Housing Allotment & Maintenance', dept: 'Housing & Urban Shelter (DUSIB/DDA)', rate: 4, resolve: 22, t: [
    'DDA flat possession delay in {area} scheme, no communication',
    'Lift not working in {area} DDA society for weeks'] },
  { cat: 'Air & Noise Pollution', dept: 'Environment & DPCC', rate: 6, resolve: 10, t: [
    'Open burning garbage smoke in {area} every evening, air pollution severe',
    'Construction dust without cover in {area}, noise pollution at night'] },
  { cat: 'Trees & Green Cover', dept: 'Environment & DPCC', rate: 3, resolve: 12, t: [
    'Tree fallen after storm blocking {area} lane, no pruning team came',
    'Illegal felling of trees observed in {area} green belt'] },
  { cat: 'Pensions', dept: 'Social Welfare', rate: 7, resolve: 14, t: [
    'Old age pension not received for three months in {area}',
    'Widow pension application pending verification in {area} district office',
    'Disability pension stopped abruptly for {area} resident'] },
  { cat: 'Welfare Schemes', dept: 'Social Welfare', rate: 4, resolve: 13, t: [
    'Scholarship amount not credited for SC student from {area}',
    'Disability certificate camp not organised in {area} as announced'] },
  { cat: 'Wages & Employment', dept: 'Labour Department', rate: 5, resolve: 16, t: [
    'Employer not paying minimum wage to workers in {area} factory',
    'BOCW labour card renewal pending for construction worker from {area}'] },
  { cat: 'Shops & Establishments', dept: 'Labour Department', rate: 2, resolve: 12, t: [
    'Shop registration certificate not generated despite payment, {area}'] },
  { cat: 'Portal & e-Service Issues', dept: 'IT Department (e-Services)', rate: 6, resolve: 3, t: [
    'Portal not working while applying online, OTP not received, from {area}',
    'Payment deducted but application stuck showing server error, {area} applicant',
    'Website down since morning, unable to upload documents from {area}',
    'Login issue and captcha failing repeatedly on the online application, {area}'] },
];

// Monday-heavy weekly pattern typical of civic complaint lines
const WEEKDAY_FACTOR = [0.55, 1.25, 1.15, 1.05, 1.0, 0.95, 0.7]; // Sun..Sat

function loadGeo() {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(GEO_DIR, f), 'utf8'));
  const wards = read('delhi_wards.geojson');
  const districts = read('delhi_districts.geojson');
  const assembly = read('delhi_assembly.geojson');
  // Pre-resolve each ward's district + AC once (via its centroid) - points are
  // jittered inside the ward, so this is accurate enough and ~100x faster.
  const wardInfo = wards.features.map((f) => {
    const c = centroid(f);
    const district = c ? featureContaining(c.lng, c.lat, districts) : null;
    const ac = c ? featureContaining(c.lng, c.lat, assembly) : null;
    return {
      feature: f,
      ward: titleCase(f.properties.Ward_Name || 'Unknown'),
      wardNo: String(f.properties.Ward_No || ''),
      district: district ? district.properties.dtname : 'Delhi',
      assemblyConstituency: ac ? ac.properties.AC_NAME : '',
    };
  });
  return { wardInfo };
}

function titleCase(s) {
  return String(s)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Generate synthetic grievances.
 * @param {object} opts
 *   days       history length (default 90)
 *   scale      volume multiplier (default 0.5 => ~150/day)
 *   seed       RNG seed (default fixed for reproducibility)
 *   spikes     [{category, fromDayOffset, days, multiplier}] - extra volume
 *              windows, offsets counted back from today (0 = today)
 * @returns {{docs: object[], agreement: number}}
 */
function generate(opts = {}) {
  const days = opts.days || 90;
  const scale = opts.scale ?? 0.5;
  const rng = makeRng(opts.seed || 20260707);
  const spikes = opts.spikes || [];
  const { wardInfo } = loadGeo();

  const now = new Date();
  const docs = [];
  let agree = 0;
  let classified = 0;
  let seq = 0;

  for (let offset = days - 1; offset >= 0; offset--) {
    const dayStart = new Date(now.getTime() - offset * 86400000);
    dayStart.setHours(0, 0, 0, 0);
    const weekday = dayStart.getDay();

    for (const p of PROFILES) {
      let lambda = p.rate * scale * WEEKDAY_FACTOR[weekday];
      for (const s of spikes) {
        if (
          s.category === p.cat &&
          offset <= s.fromDayOffset &&
          offset > s.fromDayOffset - s.days
        ) {
          lambda *= s.multiplier;
        }
      }
      const count = rng.poisson(lambda);
      for (let i = 0; i < count; i++) {
        seq++;
        const w = rng.pick(wardInfo);
        const pt = randomPointIn(w.feature, rng.random) || { lat: 28.61, lng: 77.21 };
        const registeredAt = new Date(
          dayStart.getTime() + (7 * 3600 + Math.floor(rng.random() * 14 * 3600)) * 1000
        );
        const priority = rng.weighted([
          { value: 'normal', w: 88 },
          { value: 'urgent', w: 10 },
          { value: 'sos', w: 2 },
        ]);
        const description = rng.pick(p.t).replace('{area}', w.ward);

        // Statuses/resolution: dept-specific mean, log-normal spread
        const resolveDays = rng.skewed(p.resolve);
        const resolvedAtCandidate = new Date(
          registeredAt.getTime() + resolveDays * 86400000
        );
        let status;
        let resolvedAt;
        if (resolvedAtCandidate <= now) {
          status = rng.weighted([
            { value: 'resolved', w: 90 },
            { value: 'rejected', w: 5 },
            { value: 'in_progress', w: 5 },
          ]);
          if (status === 'resolved' || status === 'rejected') resolvedAt = resolvedAtCandidate;
        } else {
          status = rng.weighted([
            { value: 'in_progress', w: 60 },
            { value: 'registered', w: 40 },
          ]);
        }
        const firstResponseAt =
          status === 'registered'
            ? undefined
            : new Date(
                Math.min(
                  registeredAt.getTime() + rng.skewed(2.5) * 86400000,
                  (resolvedAt || now).getTime()
                )
              );

        // Let the classifier re-derive dept/category from the text - measures
        // classifier quality on every seed run.
        const cls = classify(description);
        classified++;
        if (cls.department === p.dept && cls.category === p.cat) agree++;

        const sla = computeDeadlines(registeredAt, priority);
        const doc = {
          grievanceId: `SYN-${registeredAt.getFullYear()}-${String(seq).padStart(6, '0')}`,
          source: 'synthetic',
          channel: rng.weighted([
            { value: 'web', w: 45 },
            { value: 'mobile_app', w: 25 },
            { value: 'call_1076', w: 20 },
            { value: 'janta_samvad', w: 5 },
            { value: 'letter', w: 5 },
          ]),
          description,
          department: p.dept,
          category: p.cat,
          classification: {
            method: 'keyword',
            confidence: cls.confidence,
            matchedKeywords: cls.matchedKeywords,
          },
          status,
          priority,
          registeredAt,
          dayBucket: dayBucket(registeredAt),
          firstResponseAt,
          resolvedAt,
          resolutionHours: resolvedAt
            ? Math.round(((resolvedAt - registeredAt) / 3600000) * 10) / 10
            : undefined,
          sla,
          location: {
            district: w.district,
            ward: w.ward,
            wardNo: w.wardNo,
            assemblyConstituency: w.assemblyConstituency,
            lat: Math.round(pt.lat * 1e6) / 1e6,
            lng: Math.round(pt.lng * 1e6) / 1e6,
          },
        };
        const breaches = evaluateBreaches(doc, now);
        doc.sla.responseBreached = breaches.responseBreached;
        doc.sla.resolutionBreached = breaches.resolutionBreached;
        docs.push(doc);
      }
    }
  }

  return { docs, agreement: classified ? Math.round((agree / classified) * 1000) / 10 : 0 };
}

module.exports = { generate, PROFILES };
