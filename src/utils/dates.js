/**
 * Date helpers. All "day bucket" logic uses the configured timezone
 * (Asia/Kolkata by default) so that IST midnights delimit days, and buckets
 * are stored as plain "YYYY-MM-DD" strings. Storing the bucket at write time
 * keeps grouping queries trivial and portable across MongoDB-compatible
 * engines (incl. FerretDB / AWS DocumentDB).
 */
const config = require('../config');

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Date -> "YYYY-MM-DD" in the configured timezone. */
function dayBucket(date = new Date()) {
  return fmt.format(date); // en-CA locale gives ISO order
}

/** "YYYY-MM-DD" of the day `n` days before the given date. */
function dayBucketMinus(n, from = new Date()) {
  return dayBucket(new Date(from.getTime() - n * 86400000));
}

/** Array of day buckets for the trailing `days` days, oldest first. */
function lastNDayBuckets(days, from = new Date()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayBucketMinus(i, from));
  return out;
}

/** Hours between two dates, one decimal place. */
function hoursBetween(a, b) {
  return Math.round(Math.abs(b - a) / 3600000 * 10) / 10;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

module.exports = { dayBucket, dayBucketMinus, lastNDayBuckets, hoursBetween, addDays };
