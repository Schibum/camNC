import type { CadDocument } from '@wbcnc/cad';

/** Route changes and Finish keep undo; explicit Cancel discards the current edit session. */
export interface CadSession {
  entry: CadDocument;
  document: CadDocument;
  /** Exact durable source acknowledged by this view, independent of refreshed route data. */
  saved: CadDocument;
  /** Local work is retained until the user explicitly chooses a recovery action. */
  conflict?: { incoming: CadDocument };
  past: CadDocument[];
  future: CadDocument[];
  /** Reentry after acceptance uses the canonical document returned by the durable source. */
  resumeAccepted?: boolean;
}
const sessions = new Map<string, CadSession>();
const copy = (document: CadDocument): CadDocument => structuredClone(document);
const sameContent = (a: CadDocument, b: CadDocument) => JSON.stringify({ ...a, revision: 0 }) === JSON.stringify({ ...b, revision: 0 });
const fresh = (document: CadDocument): CadSession => ({
  entry: copy(document),
  document: copy(document),
  saved: copy(document),
  past: [],
  future: [],
});

export function cadSession(document: CadDocument): CadSession {
  let session = sessions.get(document.id);
  if (!session) {
    session = fresh(document);
    sessions.set(document.id, session);
  } else if (sameContent(document, session.document) || sameContent(document, session.saved)) {
    if (session.resumeAccepted) {
      session.document = copy(document);
      session.entry = copy(document);
      session.resumeAccepted = false;
    }
    session.saved = copy(document);
    delete session.conflict;
  } else if (session.resumeAccepted || sameContent(session.document, session.saved)) {
    // A newer external draft must not inherit undo commands from the previous source.
    session = fresh(document);
    sessions.set(document.id, session);
  } else {
    session.conflict = { incoming: copy(document) };
  }
  return session;
}

/** A successful guarded save advances the expected source without disturbing newer local commands. */
export function acknowledgeCadSession(session: CadSession, document: CadDocument) {
  if (document.id !== session.document.id) throw new Error('Cannot acknowledge a different CAD document into this session.');
  session.saved = copy(document);
  delete session.conflict;
}

/** Accepting a sketch updates Cancel's baseline without turning route navigation into an undo boundary. */
export function acceptCadSession(session: CadSession, document: CadDocument): CadDocument {
  if (document.id !== session.document.id) throw new Error('Cannot accept a different CAD document into this session.');
  session.document = copy(document);
  session.entry = copy(document);
  session.resumeAccepted = true;
  return session.document;
}

export function commitCadSession(session: CadSession, document: CadDocument): CadDocument {
  if (JSON.stringify(document) === JSON.stringify(session.document)) return session.document;
  session.past.push(copy(session.document));
  // Limit snapshots rather than retaining every pointer move or unbounded multi-hour history.
  if (session.past.length > 100) session.past.shift();
  session.future = [];
  session.document = { ...copy(document), revision: session.document.revision + 1 };
  session.resumeAccepted = false;
  return session.document;
}

export interface CadCommandCheckpoint {
  documentId: string;
  revision: number;
  pastLength: number;
}

export function cadCommandCheckpoint(session: CadSession): CadCommandCheckpoint {
  return { documentId: session.document.id, revision: session.document.revision, pastLength: session.past.length };
}

/** Complete a still-current creation command without making its value entry a second undo step. */
export function amendCadSession(session: CadSession, document: CadDocument, checkpoint: CadCommandCheckpoint): CadDocument | null {
  if (
    session.document.id !== checkpoint.documentId ||
    document.id !== checkpoint.documentId ||
    session.document.revision !== checkpoint.revision ||
    session.past.length !== checkpoint.pastLength ||
    session.future.length > 0
  )
    return null;
  session.document = { ...copy(document), revision: session.document.revision + 1 };
  session.resumeAccepted = false;
  return session.document;
}

export function undoCadSession(session: CadSession): CadDocument {
  const previous = session.past.pop();
  if (!previous) return session.document;
  session.future.push(copy(session.document));
  session.resumeAccepted = false;
  session.document = { ...previous, revision: session.document.revision + 1 };
  return session.document;
}

export function redoCadSession(session: CadSession): CadDocument {
  const next = session.future.pop();
  if (!next) return session.document;
  session.past.push(copy(session.document));
  session.resumeAccepted = false;
  session.document = { ...next, revision: session.document.revision + 1 };
  return session.document;
}

export function endCadSession(id: string) {
  sessions.delete(id);
}
