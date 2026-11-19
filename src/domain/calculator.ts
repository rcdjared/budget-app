export type CalculatorOperator = "+" | "−" | "×" | "÷";

export function calculateCentavos(
  left: number,
  right: number,
  operator: CalculatorOperator
): number {
  switch (operator) {
    case "+":
      return left + right;
    case "−":
      return left - right;
    case "×":
      return Math.round((left * right) / 100);
    case "÷":
      if (right === 0) throw new RangeError("Cannot divide by zero");
      return Math.round((left * 100) / right);
  }
}

export function percentCentavos(
  value: number,
  base: number | null,
  operator: CalculatorOperator | null
): number {
  if (base !== null && (operator === "+" || operator === "−")) {
    return Math.round((base * value) / 10000);
  }
  return Math.round(value / 100);
}

export function centavosToEntry(value: number): string {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
