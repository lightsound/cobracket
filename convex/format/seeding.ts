// Standard bracket placement: seed 1 and seed 2 can only meet in the final,
// byes (seat numbers beyond the roster) land on the highest seeds.

// Returns the seat order of a first round with `size` seats (a power of two):
// the seat at index i is occupied by the returned seed number. E.g. size 8 →
// [1, 8, 4, 5, 2, 7, 3, 6], pairing (1 vs 8), (4 vs 5), (2 vs 7), (3 vs 6).
export function firstRoundSeatOrder(size: number): number[] {
  let seats = [1];
  while (seats.length < size) {
    const doubled = seats.length * 2;
    seats = seats.flatMap((seed) => [seed, doubled + 1 - seed]);
  }
  return seats;
}

export function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) {
    size *= 2;
  }
  return size;
}
