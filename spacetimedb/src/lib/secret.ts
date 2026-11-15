import { hmacSha256 } from "@spacetimedb/crypto";
import { SenderError } from "spacetimedb/server";
import type { WritableDb } from "./binding";

// The module secret (ADR 0032): one 32-byte key in the private
// module_secret table, seeded once at provisioning — after publish,
// before the database is announced — and never readable through any
// view. Every module derivation keys off it: the share slug here,
// and, as they land, Events slice 1's email-code HMAC, the participant
// code (ADR 0013), and ADR 0022's sanction tags, each carrying the
// row's keyVersion as ADR 0031's design prescribed.

// The seeded secret row, or null on an unseeded database. The table
// holds at most one row by the seed rules below, so the first row is
// the row.
function secretRow(db: WritableDb) {
  for (const row of db.moduleSecret.iter()) {
    return row;
  }
  return null;
}

function anyRow<T>(rows: Iterable<T>): boolean {
  for (const _row of rows) {
    return true;
  }
  return false;
}

/** Hex to bytes, or undefined when the text is not even-length hex. */
function decodeHex(hex: string): Uint8Array | undefined {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    return undefined;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return bytes;
}

/**
 * Seed the module secret from its hex form — the provisioning act the
 * seed_module_secret reducer registers. Seeding binds nobody and
 * creates no user: it is accepted only on a completely fresh database
 * (no secret yet, no identity bound, no app_user row), which is what
 * closes the first-caller race — the publisher seeds immediately
 * after publishing, before the database's address is announced, and
 * any later caller finds one of the three facts already true and is
 * refused (ADR 0032).
 */
export function seedModuleSecret(db: WritableDb, keyHex: string): void {
  const key = decodeHex(keyHex);
  if (key === undefined) {
    throw new SenderError("Module secret key must be a hex string");
  }
  if (key.length !== 32) {
    throw new SenderError(`Module secret key must decode to exactly 32 bytes, got ${key.length}`);
  }
  if (secretRow(db) !== null) {
    throw new SenderError("Module secret is already seeded");
  }
  if (anyRow(db.identityUser.iter()) || anyRow(db.appUser.iter())) {
    throw new SenderError("Module secret can only be seeded before any identity binds");
  }
  db.moduleSecret.insert({ id: 0n, key, keyVersion: 1 });
}

// ---------------------------------------------------------------------------
// Share slugs (ADR 0032)
// ---------------------------------------------------------------------------

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_LENGTH = 12;
// Rejection sampling bound: 252 is the largest multiple of the
// alphabet's 36 that fits in a byte, so accepting only bytes below it
// makes every alphabet character equally likely.
const SLUG_BYTE_LIMIT = 252;

/** The counter value this mint consumes for `userId`, stored back +1. */
function consumeCounter(db: WritableDb, userId: bigint): bigint {
  const row = db.slugCounter.userId.find(userId);
  if (row === null) {
    db.slugCounter.insert({ userId, next: 1n });
    return 0n;
  }
  db.slugCounter.userId.update({ ...row, next: row.next + 1n });
  return row.next;
}

// The derivation input: a domain label, the key version, the
// organizer, and the per-organizer counter, each integer big-endian
// and fixed-width, so no two (version, organizer, counter) triples
// can encode to the same bytes.
function slugInput(keyVersion: number, userId: bigint, counter: bigint): Uint8Array {
  // "slug" in UTF-8, then a NUL separator before the binary fields.
  const label = new Uint8Array([0x73, 0x6c, 0x75, 0x67, 0x00]);
  const input = new Uint8Array(label.length + 4 + 8 + 8);
  input.set(label);
  const view = new DataView(input.buffer);
  view.setUint32(label.length, keyVersion, false);
  view.setBigUint64(label.length + 4, userId, false);
  view.setBigUint64(label.length + 12, counter, false);
  return input;
}

function deriveSlug(key: Uint8Array, keyVersion: number, userId: bigint, counter: bigint): string {
  const base = slugInput(keyVersion, userId, counter);
  let slug = "";
  // One digest almost always suffices (32 bytes, ~98% accepted); if
  // rejection exhausts it, re-derive with an attempt byte appended
  // rather than ever reusing a byte.
  for (let attempt = 0; slug.length < SLUG_LENGTH; attempt++) {
    const input = attempt === 0 ? base : Uint8Array.from([...base, attempt]);
    for (const byte of hmacSha256(key, input)) {
      if (byte >= SLUG_BYTE_LIMIT) {
        continue;
      }
      slug += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
      if (slug.length === SLUG_LENGTH) {
        break;
      }
    }
  }
  return slug;
}

/**
 * Mint a tournament's share slug for `userId` (ADR 0032): an
 * HMAC-SHA256 derivation over the module secret, its version, the
 * organizer, and a per-organizer counter the mint consumes.
 * Uniqueness comes from the counter — one organizer never reuses a
 * (version, counter) pair, and different organizers' inputs differ —
 * and unguessability from the key: without the secret, an observed
 * slug says nothing about any other. The slug is stored on the
 * tournament row, so a future key rotation changes only future mints.
 * The probe-then-insert backstop stays: a derived slug that somehow
 * already exists is refused and the retry consumes a fresh counter.
 * An unseeded database is an operational fault, not a caller error,
 * so it throws a plain Error (the InternalError category), like the
 * module's other invariant violations.
 */
export function mintShareSlug(db: WritableDb, userId: bigint): string {
  const secret = secretRow(db);
  if (secret === null) {
    throw new Error("Module secret is not seeded");
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = deriveSlug(secret.key, secret.keyVersion, userId, consumeCounter(db, userId));
    if (db.tournament.shareSlug.find(slug) === null) {
      return slug;
    }
  }
  throw new Error("could not allocate a share slug");
}
