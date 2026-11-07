import { addLine, createPlateDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { acceptDesign, saveDesignDraft } from './cadDesign';
import { createDesignJob, getJob } from './jobDb';

it('reports one blocking acceptance sentence without repeated contour errors or informational freedom counts', async () => {
  const empty = await createDesignJob('Acceptance notice');
  const document = { ...createPlateDocument(), id: empty.design!.draft.id };
  const accepted = await acceptDesign(await saveDesignDraft(empty, document), document);
  const invalid = structuredClone(accepted.design!.draft);
  invalid.parts[0]!.sketch = addLine(invalid.parts[0]!.sketch, { x1: 150, y1: 0, x2: 180, y2: 20 });
  invalid.revision++;
  const drafted = await saveDesignDraft(accepted, invalid);
  const error = await acceptDesign(drafted, invalid).then(
    () => null,
    (cause: unknown) => cause
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe('Close every cut contour before preparing CAM.');
  const stored = (await getJob(accepted.id))!;
  expect(stored.design!.draft).toEqual(invalid);
  expect(stored.design!.accepted).toEqual(accepted.design!.accepted);
  expect(stored.design!.acceptedRevision).toBe(accepted.design!.acceptedRevision);
});
