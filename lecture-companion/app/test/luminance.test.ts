import { describe, expect, it } from "vitest";

import {
  DARK_DECK_THRESHOLD,
  isDarkDeck,
  meanLuminance,
} from "../src/notes/luminance.ts";

/** `count` pixels of one colour, as the RGBA bytes `getImageData` hands back. */
function fill(count: number, r: number, g: number, b: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i += 1) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function concat(a: Uint8ClampedArray, b: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

describe("meanLuminance", () => {
  it("reads white as 1 and black as 0", () => {
    expect(meanLuminance(fill(16, 255, 255, 255))).toBeCloseTo(1, 6);
    expect(meanLuminance(fill(16, 0, 0, 0))).toBeCloseTo(0, 6);
  });

  it("weights the channels by Rec. 709", () => {
    expect(meanLuminance(fill(4, 255, 0, 0))).toBeCloseTo(0.2126, 4);
    expect(meanLuminance(fill(4, 0, 255, 0))).toBeCloseTo(0.7152, 4);
    expect(meanLuminance(fill(4, 0, 0, 255))).toBeCloseTo(0.0722, 4);
  });

  it("averages over the whole image", () => {
    expect(meanLuminance(concat(fill(8, 255, 255, 255), fill(8, 0, 0, 0)))).toBeCloseTo(0.5, 6);
    // A dark deck: a black plate with a quarter of it light text.
    expect(meanLuminance(concat(fill(3, 20, 22, 26), fill(1, 221, 227, 233)))).toBeLessThan(
      DARK_DECK_THRESHOLD,
    );
  });

  it("calls an empty buffer light rather than dividing by zero", () => {
    expect(meanLuminance(new Uint8ClampedArray(0))).toBe(1);
    expect(meanLuminance(new Uint8ClampedArray(2))).toBe(1);
  });
});

describe("isDarkDeck", () => {
  it("switches blending below a mean luminance of 0.5", () => {
    expect(isDarkDeck(0.12)).toBe(true);
    expect(isDarkDeck(0.49999)).toBe(true);
    expect(isDarkDeck(0.5)).toBe(false);
    // The professor's usual white plate with black type.
    expect(isDarkDeck(meanLuminance(concat(fill(9, 255, 255, 255), fill(1, 0, 0, 0))))).toBe(false);
  });
});
