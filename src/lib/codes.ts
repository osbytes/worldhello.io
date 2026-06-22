import { customAlphabet } from "nanoid";

// Unambiguous alphabet (no 0/O/1/l/I). 8 chars ≈ 50^8 ≈ 3.9e13 space.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const nano = customAlphabet(ALPHABET, 8);

/** Short share code for a node. Collision-checked at insert (unique constraint). */
export function newCode(): string {
  return nano();
}

export const MAX_DEPTH = 50; // DESIGN §6.5 — cap pathological linear chains.
