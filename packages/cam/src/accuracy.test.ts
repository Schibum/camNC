import { describe, expect, it } from 'vitest';
import { accuracyBudget, checkAccuracyBudget, planAccuracy } from './accuracy';

describe('job geometry accuracy', () => {
  it('reserves both polygon and XYZ output quantization inside the total', () => {
    const budget = accuracyBudget(0.01);
    checkAccuracyBudget(budget);
    const { total, ...stages } = budget;
    expect(Object.values(stages).reduce((a, b) => a + b, 0)).toBeCloseTo(total, 12);
    expect(budget.outputRounding).toBeCloseTo(Math.sqrt(3) * 0.0005);
    expect(budget.polygonRounding).toBeGreaterThan(0);
    expect(budget.controllerRounding).toBeCloseTo(Math.sqrt(3) * 2 ** -10);
  });

  it('rejects an unrepresentable tolerance and an over-allocated stage budget', () => {
    expect(() => accuracyBudget(0.0001)).toThrow(/quantization/);
    const budget = accuracyBudget();
    expect(() => checkAccuracyBudget({ ...budget, fitting: budget.total })).toThrow(/exceed/);
    expect(() => accuracyBudget(NaN)).toThrow();
    expect(() => accuracyBudget(0.01, 1.5)).toThrow();
  });

  it('keeps source uncertainty explicit instead of certifying an unknown import', () => {
    expect(planAccuracy().scope).toBe('features');
    const declared = planAccuracy(0.05, 0.01);
    expect(declared.scope).toBe('declared-source');
    expect(declared.budget.import).toBe(0.01);
    checkAccuracyBudget(declared.budget);
    expect(() => planAccuracy(0.01, 0.02)).toThrow();
  });
});
