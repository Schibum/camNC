export interface FluidAxisConfig {
  max_travel_mm?: number;
  homing?: {
    mpos_mm?: number;
    positive_direction?: boolean;
  };
}

// Compute the bounds of an axis based on the homing position and the max travel like here:
// https://github.com/bdring/FluidNC/blob/7de6a5de3bed8bb1f5fe2fd9cdd5a1bf392c02b6/FluidNC/src/Limits.cpp#L101
// Defaults match FluidNC (Axis.h, Homing.h): positive_direction is true, mpos_mm is 0 and max_travel_mm is 1000.
export function computeAxisBounds(axis: FluidAxisConfig) {
  const homing = axis.homing;
  const origin = homing?.mpos_mm ?? 0;
  const maxTravel = axis.max_travel_mm ?? 1000;
  const positiveDirection = !homing || (homing.positive_direction ?? true);
  const min = positiveDirection ? origin - maxTravel : origin;
  const max = positiveDirection ? origin : origin + maxTravel;
  return { min, max };
}
