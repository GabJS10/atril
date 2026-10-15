import { describe, expect, it } from "vitest";
import { fileName } from "./paths";

describe("fileName", () => {
  it.each([
    ["/home/gabriel/Libros/a.pdf", "a.pdf"],
    ["C:\\Users\\x\\Libros\\a.pdf", "a.pdf"],
    ["\\\\servidor\\Libros\\Pedro Páramo.pdf", "Pedro Páramo.pdf"],
    ["D:\\Libros\\Carpeta\\", "Carpeta"],
    ["/home/gabriel/Libros/", "Libros"],
    ["a.pdf", "a.pdf"],
  ])("takes the last name of %s", (path, expected) => {
    expect(fileName(path)).toBe(expected);
  });

  it("gives the drive of a drive root and the input of an empty path", () => {
    expect(fileName("C:\\")).toBe("C:");
    expect(fileName("")).toBe("");
  });
});
