// three-stdlib's OrbitControls keeps (1 - dampingFactor) of the remaining motion each frame.
// The default 0.05 glides for ~2 s after a drag is released; 0.3 settles in ~0.2 s at 60 fps.
export const kOrbitDamping = 0.3;
