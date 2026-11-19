import { describe, expect, it } from "vitest";
import {
  calculateCentavos,
  centavosToEntry,
  percentCentavos,
} from "@/domain/calculator";

describe("transaction amount calculator", () => {
  it("adds and subtracts centavos", () => {
    expect(calculateCentavos(1250, 250, "+")).toBe(1500);
    expect(calculateCentavos(1250, 250, "−")).toBe(1000);
  });

  it("multiplies and divides currency amounts with centavo rounding", () => {
    expect(calculateCentavos(1234, 200, "×")).toBe(2468);
    expect(calculateCentavos(10000, 300, "÷")).toBe(3333);
  });

  it("throws a clear error for division by zero", () => {
    expect(() => calculateCentavos(10000, 0, "÷")).toThrow("Cannot divide by zero");
  });

  it("calculates a percentage of the first operand for addition and subtraction", () => {
    expect(percentCentavos(1000, 20000, "+")).toBe(2000);
    expect(percentCentavos(1000, 20000, "−")).toBe(2000);
  });

  it("converts a standalone percent to a decimal amount", () => {
    expect(percentCentavos(2500, null, null)).toBe(25);
  });

  it("formats results for the amount entry without floating point conversion", () => {
    expect(centavosToEntry(123456)).toBe("1234.56");
    expect(centavosToEntry(-50)).toBe("-0.50");
  });
});
