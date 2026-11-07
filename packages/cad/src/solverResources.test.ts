import { make_gcs_wrapper } from '@salusoft89/planegcs';
import { expect, it } from 'vitest';
import { addLine, createCadPart } from './document';
import { classifyNativeEntities } from './entityFreedom';

it('uses bounded native scratch parameters instead of accumulating constants for every entity-rank probe', async () => {
  const part = createCadPart();
  for (let i = 1; i <= 8; i++) part.sketch = addLine(part.sketch, { x1: 3 * i, y1: 0, x2: 3 * i + 1, y2: 1 });
  const wrapper = await make_gcs_wrapper();
  try {
    wrapper.push_primitives_and_params(
      part.sketch.entities.map(entity => {
        if (entity.type === 'point')
          return { id: entity.id, type: 'point' as const, x: entity.x, y: entity.y, fixed: entity.fixed ?? false };
        if (entity.type === 'line') return { id: entity.id, type: 'line' as const, p1_id: entity.startId, p2_id: entity.endId };
        throw Error('Expected line fixture');
      })
    );
    wrapper.solve();
    const before = wrapper.gcs.params_size();
    const analysis = classifyNativeEntities(part.sketch, wrapper);
    expect(analysis.probes).toBe(16);
    expect(Object.values(analysis.status).filter(status => status === 'underconstrained')).toHaveLength(24);
    expect(wrapper.gcs.params_size() - before).toBeLessThanOrEqual(3);
    expect(wrapper.gcs.dof()).toBe(32);
  } finally {
    wrapper.destroy_gcs_module();
  }
});
