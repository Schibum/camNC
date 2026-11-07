import { createPlateDocument, updateDimension } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { acceptCadSession, acknowledgeCadSession, cadSession, commitCadSession, endCadSession, undoCadSession } from './session';

it('S5 replaces an older saved route session with another view’s newer draft', () => {
  const document = createPlateDocument();
  const width = document.parts[0].sketch.constraints.find(c => c.label === 'Width')!;
  const session = cadSession(document);
  const savedA = commitCadSession(session, updateDimension(document, width.id, 160));
  // A leaves the route and returns once to the source it durably saved.
  cadSession(savedA);
  const savedB = updateDimension(savedA, width.id, 180);
  const reopened = cadSession(savedB);
  expect(reopened.document).toEqual(savedB);
  expect(reopened.entry).toEqual(savedB);
  expect(reopened.past).toHaveLength(0);
  expect(reopened.future).toHaveLength(0);
  expect(session.document).toEqual(savedA);
  endCadSession(document.id);
});

it('S5 keeps unconfirmed local work recoverable and explicitly marks a conflicting incoming draft', () => {
  const document = createPlateDocument();
  const width = document.parts[0].sketch.constraints.find(c => c.label === 'Width')!;
  const session = cadSession(document);
  const savedA = commitCadSession(session, updateDimension(document, width.id, 160));
  cadSession(savedA);
  const local = commitCadSession(session, updateDimension(savedA, width.id, 170));
  const savedB = updateDimension(savedA, width.id, 180);
  const reopened = cadSession(savedB);
  expect(reopened).toBe(session);
  expect(reopened.document).toEqual(local);
  expect(reopened).toMatchObject({ conflict: { incoming: savedB } });
  expect(reopened.past).toHaveLength(2);
  endCadSession(document.id);
});

it('S5 acknowledges an earlier queued save without dropping a newer unconfirmed local command', () => {
  const document = createPlateDocument();
  const width = document.parts[0].sketch.constraints.find(c => c.label === 'Width')!;
  const session = cadSession(document);
  const savedA = commitCadSession(session, updateDimension(document, width.id, 160));
  const local = commitCadSession(session, updateDimension(savedA, width.id, 170));
  acknowledgeCadSession(session, savedA);
  expect(session.saved).toEqual(savedA);
  expect(session.document).toEqual(local);
  expect(cadSession(savedA).document).toEqual(local);
  expect(session.past).toHaveLength(2);
  expect(session.conflict).toBeUndefined();
  endCadSession(document.id);
});

it('S5 drops stale history when a foreign draft arrives after this view finished an undone source', () => {
  const document = createPlateDocument();
  const width = document.parts[0].sketch.constraints.find(c => c.label === 'Width')!;
  const session = cadSession(document);
  commitCadSession(session, updateDimension(document, width.id, 160));
  const accepted = undoCadSession(session);
  acknowledgeCadSession(session, accepted);
  acceptCadSession(session, accepted);
  expect(session.future).toHaveLength(1);
  const foreign = updateDimension(accepted, width.id, 180);
  const reopened = cadSession(foreign);
  expect(reopened.document).toEqual(foreign);
  expect(reopened.past).toHaveLength(0);
  expect(reopened.future).toHaveLength(0);
  endCadSession(document.id);
});

it('S5 uses an exact incoming snapshot for future CAS while preserving history for revision-only changes', () => {
  const document = createPlateDocument();
  const width = document.parts[0].sketch.constraints.find(c => c.label === 'Width')!;
  const session = cadSession(document);
  const local = commitCadSession(session, updateDimension(document, width.id, 160));
  acknowledgeCadSession(session, local);
  const incoming = { ...structuredClone(local), revision: 100 };
  const reopened = cadSession(incoming);
  expect(reopened).toBe(session);
  expect(reopened.saved).toEqual(incoming);
  expect(reopened.past).toHaveLength(1);
  expect(reopened.conflict).toBeUndefined();
  endCadSession(document.id);
});
