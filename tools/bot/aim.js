// How a bot shoots. Pure; `rand` is injected so tests are seeded.

// A gun's role, read only from its numbers, so a new gun needs no bot code.
export const roleOf = (w) => ((w.pellets ?? 1) > 1 ? 'close' : w.auto ? 'burst' : w.rps < 2 ? 'precision' : 'tap');

// Where a bot likes to fight from: a sidearm up close, a gun with falloff
// well inside it, anything else at mid range.
export const idealRange = (w, sidearm) => (sidearm ? 12 : w.falloff ? 0.6 * w.falloff.from : 18);
