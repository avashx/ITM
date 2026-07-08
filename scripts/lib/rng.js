/**
 * Deterministic RNG (mulberry32) + distribution helpers so synthetic seeds
 * are reproducible: same --seed => same dataset.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed = 20260707) {
  const rng = mulberry32(seed);
  return {
    random: rng,
    /** integer in [min, max] inclusive */
    int: (min, max) => min + Math.floor(rng() * (max - min + 1)),
    /** pick a random element */
    pick: (arr) => arr[Math.floor(rng() * arr.length)],
    /** weighted pick from [{value, w}] */
    weighted(items) {
      const total = items.reduce((s, i) => s + i.w, 0);
      let roll = rng() * total;
      for (const i of items) {
        roll -= i.w;
        if (roll <= 0) return i.value;
      }
      return items[items.length - 1].value;
    },
    /** Poisson sample (Knuth) - fine for small lambdas used here */
    poisson(lambda) {
      if (lambda <= 0) return 0;
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= rng();
      } while (p > L);
      return k - 1;
    },
    /** log-normal-ish positive sample around `mean` (for resolution times) */
    skewed(mean, spread = 0.6) {
      const u = rng();
      const v = rng();
      const gauss = Math.sqrt(-2 * Math.log(u || 1e-9)) * Math.cos(2 * Math.PI * v);
      return Math.max(0.05, mean * Math.exp(spread * gauss - (spread * spread) / 2));
    },
  };
}

module.exports = { makeRng };
