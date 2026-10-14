import { describe, expect, it } from "vitest";
import { COVER_TONES, coverToneOf, ROOM_COLORS, roomColorOf, tintOf } from "./identity";

describe("identity", () => {
  it("gives the same tone to the same id, always inside the palette", () => {
    expect(coverToneOf("abc123")).toBe(coverToneOf("abc123"));
    for (const id of ["a", "b", "0f3c", "9f8e7d6c5b4a", "Meditaciones"]) {
      const tone = coverToneOf(id);
      expect(Number.isInteger(tone)).toBe(true);
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(COVER_TONES);
    }
  });

  it("spreads ids over the palette instead of using one tone", () => {
    const tones = new Set(Array.from({ length: 200 }, (_, index) => coverToneOf(`book-${index}`)));
    expect(tones.size).toBeGreaterThan(COVER_TONES / 2);
  });

  it("gives the same colour to the same Sala, always inside the palette", () => {
    expect(roomColorOf("room-1")).toBe(roomColorOf("room-1"));
    const colors = new Set(Array.from({ length: 100 }, (_, index) => roomColorOf(`room-${index}`)));
    expect(colors.size).toBeGreaterThan(ROOM_COLORS / 2);
    for (const color of colors) expect(color).toBeLessThan(ROOM_COLORS);
  });
});

describe("tintOf", () => {
  it("keeps coloured covers", () => {
    expect(tintOf("#7a2e26")).toBe("#7a2e26");
    expect(tintOf("#E6DECD")).toBe("#E6DECD");
  });

  it("drops the light greys of a blank first page", () => {
    expect(tintOf("#f4f4f4")).toBeNull();
    expect(tintOf("#ffffff")).toBeNull();
  });

  it("keeps dark greys (a black cover is still a colour) and ignores bad input", () => {
    expect(tintOf("#222222")).toBe("#222222");
    expect(tintOf(null)).toBeNull();
    expect(tintOf("rojo")).toBeNull();
  });
});
