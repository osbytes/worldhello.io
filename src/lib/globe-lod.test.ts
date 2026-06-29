import { describe, it, expect } from "vitest";
import { binDegreesForNodeCount, globeDotScale } from "./globe-lod";

describe("binDegreesForNodeCount", () => {
  it("uses finer bins for smaller datasets", () => {
    expect(binDegreesForNodeCount(6_000)).toEqual({ binLat: 4, binLng: 6 });
    expect(binDegreesForNodeCount(25_000)).toEqual({ binLat: 6, binLng: 9 });
    expect(binDegreesForNodeCount(60_000)).toEqual({ binLat: 8, binLng: 12 });
    expect(binDegreesForNodeCount(150_000)).toEqual({ binLat: 10, binLng: 15 });
  });
});

describe("globeDotScale", () => {
  it("scales verified raw points", () => {
    expect(globeDotScale({ v: 1 })).toBe(1.6);
    expect(globeDotScale({ v: 0 })).toBe(1);
  });

  it("scales density bins by count", () => {
    expect(globeDotScale({ v: 0, n: 1 })).toBe(1);
    expect(globeDotScale({ v: 0, n: 8 })).toBeGreaterThan(1.5);
    expect(globeDotScale({ v: 0, n: 10_000 })).toBeLessThanOrEqual(3.2);
  });
});
