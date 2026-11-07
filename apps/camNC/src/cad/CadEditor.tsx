import {
  addArc,
  addBezier,
  addCircle,
  addConic,
  addCenterRectangle,
  addConstraint,
  addLine,
  addPoint,
  addRectangle,
  addSpline,
  createCadPart,
  constraintEntityIds,
  dimensionValueError,
  entityPointIds as curvePointIds,
  filletLineCorners,
  extendSketchCurve,
  mirrorSketchEntities,
  offsetSketch,
  insertCurveControlPoint,
  isSplineTangentHandle,
  isOwnedSplineHandle,
  removeEntity,
  originId,
  newCadId,
  pointEquivalence,
  resolveFilletCorners,
  setConicRho,
  setDimensionDriven,
  tessellateCurve,
  updateDimension,
  visibleSketchPointIds,
  withDimensionPlacement,
  type CadConstraint,
  type CadDimension,
  type CadDimensionMode,
  type CadDocument,
  type CadEntity,
  type CadPart,
  type CadSketch,
  type CadSketchSolveStatus,
  type CadSolveOptions,
} from '@wbcnc/cad';
import {
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
} from 'react';
import { prepareDimensionCreation, solveCadDocument } from './solveCad';
import { acquireCadKeyboard } from './keyboardOwnership';
import {
  amendCadSession,
  acceptCadSession,
  cadCommandCheckpoint,
  cadSession,
  commitCadSession,
  endCadSession,
  redoCadSession,
  undoCadSession,
  type CadCommandCheckpoint,
} from './session';
import { DimensionGraphics } from './DimensionGraphics';
import {
  idleDimensionWorkflow,
  transitionDimensionWorkflow,
  type DimensionWorkflow,
  type DimensionWorkflowEvent,
} from './dimensionWorkflow';
import { idleDrawingGesture, transitionDrawingGesture, type DrawingGesture } from './drawingGesture';
import { advanceCreationValue, beginCreationValues, creationValueAnchor, creationValueAt, type CreationValues } from './creationValues';
import { CreationValueControls } from './CreationValueControls';
import { CadValueInput } from './CadValueInput';
import { parseCadValue } from './valueExpressions';
import { SelectionReadout } from './SelectionReadout';
import { CadThicknessField } from './CadThicknessField';
import { SketchContextMenu } from './SketchContextMenu';
import {
  createSketchContext,
  pickSketchContextTarget,
  selectedSketchContextTarget,
  toggleContextConstruction,
  transitionSketchContextPress,
  type SketchContext,
  type SketchContextAction,
  type SketchContextPress,
  type SketchContextTarget,
} from './sketchContext';
import { dimensionAnchor } from './dimensionGeometry';
import { tangentArcFrom, threePointArc } from './geometry';
import { trimSketchCurveAt } from './trimCurves';
import { pickBezierControlPolygon, pickSketchPoint, pickSketchSnap, type CadSnapResult } from './picking';
import { inferDrawingPoint, inferredPointConstraints, type CadDrawingInference } from './drawingInference';
import { DrawingInferencePreview } from './DrawingInferencePreview';
import { tangentLineAxis, type InferredLineAxis } from './lineInference';
import { buildConstraintForSelection, constraintPrompt, type ConstraintCommandTool } from './constraintCommands';
import { cadViewState, saveCadViewState } from './viewState';
import { dragTargets, hasDragMovement } from './drag';
import { dragSnapConstraints, inferDragPoint } from './dragSnap';
import { boxSelectSketch, type CadSelectionBox } from './boxSelection';
import { constraintColorNotice, sketchDofStatus, sketchFeedback } from './sketchFeedback';
import { isDemoMode } from '@/lib/demo/demo-mode';
import { SketchToolbar, SketchToolGlyph } from './SketchToolbar';
import { sketchTools as tools, type SketchTool } from './sketchTools';
import { SketchGeometry } from './SketchGeometry';
import { SketchRegion } from './SketchRegion';
import { SketchToolPreview } from './SketchToolPreview';
import { ModificationControls } from './ModificationControls';
import { ModificationPreview } from './ModificationPreview';
import {
  beginModification,
  idleModificationWorkflow,
  modificationSourceIds,
  transitionModification,
  type ModificationWorkflow,
} from './modificationWorkflow';
import { useSvgPixelScale, SKETCH_APPEARANCE } from './sketchAppearance';
import { InlineConstraints } from './inlineConstraints';
import { associatedEntityIds, removeInlineConstraint } from './inlineConstraintLayout';
import './cad.css';

type Point = { x: number; y: number };
type SketchPoint = Extract<CadEntity, { type: 'point' }>;
type NumericConstraint = Extract<CadConstraint, { value: number }>;
type Tool = SketchTool;
type DimensionMode = CadDimensionMode;
type ConstraintTool = ConstraintCommandTool;
type ChainAnchor = { pointId: string; curveId: string };
const snapLabels: Record<CadSnapResult['kind'], string> = {
  endpoint: 'Endpoint',
  center: 'Center',
  point: 'Point',
  midpoint: 'Midpoint',
  pointOnCurve: 'On curve',
};
interface DragGesture {
  origin: Point;
  target: Point;
  document: CadDocument;
  preview: CadDocument;
  partId: string;
  selectedIds: string[];
  points: string[];
  radiusEntityId?: string;
  moved: boolean;
  request: number;
  solvedRequest: number;
  working: boolean;
  ended: boolean;
  failure?: string;
  snapPointId?: string;
  dropInference?: CadDrawingInference | null;
}
interface BoxGesture extends CadSelectionBox {
  screenStart: Point;
  selected: string[];
  additive: boolean;
  moved: boolean;
}
interface AnnotationGesture {
  id: string;
  document: CadDocument;
  screenStart: Point;
  worldStart: Point;
  position: Point;
  moved: boolean;
}

type View = { x: number; y: number; w: number; h: number };
const initialView: View = { x: -35, y: -175, w: 300, h: 210 };
const rounded = (n: number) => Math.round(n * 100) / 100;
const numeric = (c: CadConstraint): c is NumericConstraint => 'value' in c;

const pointsOf = (sketch: CadSketch) => new Map(sketch.entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));
const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest('input:not([type="checkbox"]),textarea,select,[contenteditable]');
const entityPointIds = (entity: CadEntity): string[] => {
  if (entity.type === 'point') return [entity.id];
  return curvePointIds(entity);
};
function replacePart(document: CadDocument, partId: string, change: (part: CadPart) => CadPart): CadDocument {
  return { ...document, parts: document.parts.map(p => (p.id === partId ? change(p) : p)) };
}
function chainGeometry(sketch: CadSketch, chain: ChainAnchor | null) {
  if (!chain) return null;
  const points = pointsOf(sketch);
  const point = points.get(chain.pointId);
  const curve = sketch.entities.find(e => e.id === chain.curveId);
  if (!point || !curve) return null;
  if (curve.type === 'line') {
    const other = points.get(curve.startId === point.id ? curve.endId : curve.startId);
    if (other) return { point, tangent: { x: point.x - other.x, y: point.y - other.y }, curve };
  }
  if (curve.type === 'arc') {
    const center = points.get(curve.centerId);
    if (center) {
      const direction = curve.endId === point.id ? 1 : -1;
      return { point, tangent: { x: -(point.y - center.y) * direction, y: (point.x - center.x) * direction }, curve };
    }
  }
  return null;
}

export interface CadEditorController {
  /** Commit valid open value fields to the draft without accepting it or navigating. */
  prepareDocument: () => CadDocument | null;
  /** Use the same validation and accepted-session boundary as the Finish button. */
  finish: () => Promise<boolean>;
}

export interface CadEditorProps {
  document: CadDocument;
  onDraftChange: (document: CadDocument) => void;
  onFinish: (document: CadDocument) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  onFinishBlocked?: (reason: string) => void;
  saveStatus?: string;
  notice?: string | null;
  preferredPartId?: string;
  controller?: Ref<CadEditorController>;
}

/** Native editable source stays in one document while CAM remains a derived consumer of accepted revisions. */
export function CadEditor({
  document: initialDocument,
  onDraftChange,
  onFinish,
  onCancel,
  onFinishBlocked,
  saveStatus,
  notice,
  preferredPartId,
  controller,
}: CadEditorProps) {
  const [session] = useState(() => cadSession(initialDocument));
  const [doc, setDocument] = useState(session.document);
  const [savedView] = useState(() => cadViewState(session.document, initialView, preferredPartId));
  const [partId, setPartId] = useState(savedView.selectedPartId);
  const part = doc.parts.find(p => p.id === partId) ?? doc.parts[0];
  const sketch = part?.sketch;
  const [tool, setTool] = useState<Tool>('select');
  const [construction, setConstruction] = useState(false);
  const [selected, setSelected] = useState<string[]>(savedView.selectedEntityIds);
  const selectionHints = useRef<Record<string, Point>>({});
  const [selectedConstraints, setSelectedConstraints] = useState<string[]>([]);
  const [showConstraints, setShowConstraints] = useState(true);
  const [hoveredConstraintEntities, setHoveredConstraintEntities] = useState<string[]>([]);
  const [conflictedConstraints, setConflictedConstraints] = useState<string[]>([]);
  const [pending, setPending] = useState<Point[]>([]);
  // A completed line leaves a continuation anchor, not an uncommitted new segment.
  const [lineContinuation, setLineContinuation] = useState(false);
  const [chain, setChain] = useState<ChainAnchor | null>(null);
  const [contextualArc, setContextualArc] = useState(false);
  const [constraintMode, setConstraintMode] = useState<ConstraintTool | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<string | null>(null);
  const [snapCue, setSnapCue] = useState<{ point: Point; label: string } | null>(null);
  const lastSnap = useRef<CadSnapResult | null>(null);
  const pendingSnaps = useRef<(CadDrawingInference | null)[]>([]);
  const lastDrawingHint = useRef<CadDrawingInference | null>(null);
  const [drawingCue, setDrawingCue] = useState<CadDrawingInference | null>(null);
  const hoveredReferences = useRef<string[]>([]);
  const inference = useRef<'horizontal' | 'vertical' | 'tangent' | null>(null);
  const tangentAxis = useRef<InferredLineAxis | null>(null);
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 });
  const [snap, setSnap] = useState(true);
  const [view, setView] = useState(savedView.view);
  const [dimension, setDimension] = useState<string | null>(null);
  const [dimensionFlow, setDimensionFlow] = useState<DimensionWorkflow>(idleDimensionWorkflow);
  const drawingGesture = useRef<DrawingGesture>(idleDrawingGesture());
  const [creationValues, setCreationValues] = useState<CreationValues | null>(null);
  const dimensionMode = dimensionFlow.mode;
  const placingDimension = dimensionFlow.phase === 'placing';
  const dimensionDraft = dimensionFlow.phase === 'placing' && !dimensionFlow.existingConstraintId ? dimensionFlow.preview : null;
  const dimensionSelection = dimensionFlow.phase === 'idle' ? selected : dimensionFlow.entityIds;
  const [palette, setPalette] = useState(false);
  const [status, setStatus] = useState('Checking sketch…');
  const [problems, setProblems] = useState<string[]>([]);
  const [inProgress, setInProgress] = useState(false);
  const [solving, setSolving] = useState(true);
  const [checkEpoch, setCheckEpoch] = useState(0);
  const [sketchStatuses, setSketchStatuses] = useState<Record<string, CadSketchSolveStatus>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Choose a drawing tool or select geometry.');
  const [finishError, setFinishError] = useState<string | null>(null);
  const [width, setWidth] = useState('100');
  const [height, setHeight] = useState('60');
  const [radius, setRadius] = useState('10');
  const [filletRadius, setFilletRadius] = useState('10');
  const [filletEditing, setFilletEditing] = useState(false);
  const [modification, setModification] = useState<ModificationWorkflow>(idleModificationWorkflow);
  const [hoveredModifyCurve, setHoveredModifyCurve] = useState<string | null>(null);
  const [modifyTarget, setModifyTarget] = useState<Point | null>(null);
  const [conicEditing, setConicEditing] = useState<string | null>(null);
  const [rho, setRho] = useState('0.5');
  const [selectionBox, setSelectionBox] = useState<CadSelectionBox | null>(null);
  const [contextMenu, setContextMenu] = useState<SketchContext | null>(null);
  const contextPress = useRef<SketchContextPress>({ phase: 'idle' });
  const [thicknessValid, setThicknessValid] = useState(true);
  const svg = useRef<SVGSVGElement>(null);
  const markerScale = useSvgPixelScale(svg, view);
  const root = useRef<HTMLDivElement>(null);
  const dimensionInput = useRef<HTMLInputElement>(null);
  const filletInput = useRef<HTMLInputElement>(null);
  const offsetInput = useRef<HTMLInputElement>(null);
  const rhoInput = useRef<HTMLInputElement>(null);
  const creationInput = useRef<HTMLInputElement>(null);
  const newCurveCommand = useRef<{ id: string; checkpoint: CadCommandCheckpoint } | null>(null);
  const newDimensionCommand = useRef<{ id: string; checkpoint: CadCommandCheckpoint } | null>(null);
  const drag = useRef<DragGesture | null>(null);
  const annotationDrag = useRef<AnnotationGesture | null>(null);
  const boxGesture = useRef<BoxGesture | null>(null);
  const pan = useRef<{ x: number; y: number; view: View } | null>(null);
  const solveSequence = useRef(0);
  const lastCheckedRevision = useRef('');
  const documentRef = useRef(doc);
  documentRef.current = doc;
  const callbacks = useRef({ onDraftChange, onFinish, onCancel, onFinishBlocked });
  const finishing = useRef(false);
  const preparingDimension = useRef(false);
  const mounted = useRef(true);
  callbacks.current = { onDraftChange, onFinish, onCancel, onFinishBlocked };
  const deferredCanvasFocus = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (!busy) {
      const restore = deferredCanvasFocus.current;
      deferredCanvasFocus.current = null;
      restore?.();
    }
  }, [busy]);
  const restoreCanvasKeyboard = () => {
    const restore = () => {
      const canvas = svg.current,
        active = canvas?.ownerDocument.activeElement;
      // Solves finish before React removes workspace inertness. Focus only after
      // that DOM commit, even when background animation frames are suspended.
      if (canvas?.closest('[inert]')) {
        deferredCanvasFocus.current = restore;
        return;
      }
      deferredCanvasFocus.current = null;
      if (canvas && (!active || active === canvas.ownerDocument.body || canvas.contains(active))) canvas.focus();
    };
    // Keyboard ownership must not wait for a frame in a background tab. Recheck
    // after rendering as well, when a dismissed control may have lost focus.
    restore();
    requestAnimationFrame(restore);
  };
  const requestSketchCheck = () => {
    const current = documentRef.current;
    if (lastCheckedRevision.current !== `${current.id}:${current.revision}`) setCheckEpoch(epoch => epoch + 1);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const filletSelection = useMemo(
    () => (sketch && tool === 'fillet' ? resolveFilletCorners(sketch, selected) : null),
    [sketch, tool, selected]
  );
  const filletPreview = useMemo(() => {
    if (!sketch || !filletSelection?.ok) return null;
    const radius = parseCadValue(filletRadius, { unit: 'mm' });
    return 'error' in radius
      ? { ok: false as const, message: radius.error, cornerPointIds: filletSelection.cornerPointIds }
      : filletLineCorners(sketch, { cornerPointIds: filletSelection.cornerPointIds, radius: radius.value });
  }, [sketch, filletSelection, filletRadius]);
  const shownSketch = filletPreview?.ok ? filletPreview.sketch : sketch;
  const offsetPreview = useMemo(() => {
    if (!sketch || modification.phase !== 'offset' || !modification.entityIds.length) return null;
    const parsed = parseCadValue(modification.text, { unit: 'mm' });
    return 'error' in parsed
      ? { ok: false as const, message: parsed.error }
      : offsetSketch(sketch, { entityIds: modification.entityIds, value: parsed.value });
  }, [sketch, modification]);
  const extendPreview = useMemo(
    () =>
      sketch && modification.phase === 'extend' && modification.entityId && modification.end && modifyTarget
        ? extendSketchCurve(sketch, {
            entityId: modification.entityId,
            end: modification.end,
            target: modifyTarget,
            boundaryId: hoveredModifyCurve && hoveredModifyCurve !== modification.entityId ? hoveredModifyCurve : undefined,
          })
        : null,
    [sketch, modification, modifyTarget, hoveredModifyCurve]
  );
  const mirrorPreview = useMemo(
    () =>
      sketch && modification.phase === 'mirror' && modification.picking === 'axis' && modification.entityIds.length && hoveredModifyCurve
        ? mirrorSketchEntities(sketch, { entityIds: modification.entityIds, axisId: hoveredModifyCurve })
        : null,
    [sketch, modification, hoveredModifyCurve]
  );
  const modificationPreview = offsetPreview?.ok
    ? offsetPreview
    : extendPreview?.ok
      ? extendPreview
      : mirrorPreview?.ok
        ? mirrorPreview
        : null;
  const curvePreview = useMemo(() => {
    if (!sketch || !pending.length || !['conic', 'spline', 'bezier'].includes(tool)) return null;
    const locations = [...pending];
    if (Math.hypot(cursor.x - locations.at(-1)!.x, cursor.y - locations.at(-1)!.y) > 1e-7) locations.push(cursor);
    if (locations.length < 2) return null;
    try {
      const parsedRho = parseCadValue(rho, { unit: 'scalar' });
      if (tool === 'conic' && 'error' in parsedRho) return locations;
      const preview =
        tool === 'conic'
          ? locations[2]
            ? addConic(sketch, {
                start: locations[0]!,
                end: locations[1]!,
                control: locations[2]!,
                rho: 'value' in parsedRho ? parsedRho.value : 0.5,
                construction,
              })
            : null
          : (tool === 'spline' ? addSpline : addBezier)(sketch, { points: locations, construction });
      const curve = preview?.entities.at(-1);
      return curve && curve.type !== 'point' ? tessellateCurve(curve, pointsOf(preview!), 0.25 / markerScale) : locations;
    } catch {
      return locations;
    }
  }, [sketch, pending, cursor, tool, rho, construction, markerScale]);
  useEffect(() => {
    svg.current?.focus();
    const release = acquireCadKeyboard();
    return () => {
      drag.current = null;
      annotationDrag.current = null;
      boxGesture.current = null;
      drawingGesture.current = idleDrawingGesture();
      contextPress.current = { phase: 'idle' };
      release();
    };
  }, []);

  useEffect(() => {
    const canvas = svg.current;
    if (!canvas) return;
    const zoom = (event: WheelEvent) => {
      if (!event.deltaY) return;
      event.preventDefault();
      const matrix = canvas.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const factor = event.deltaY > 0 ? 1.12 : 1 / 1.12;
      setView(v => ({
        x: point.x + (v.x - point.x) * factor,
        y: point.y + (v.y - point.y) * factor,
        w: Math.max(10, Math.min(10000, v.w * factor)),
        h: Math.max(10, Math.min(10000, v.h * factor)),
      }));
    };
    // React's delegated wheel listener is passive; zoom must cancel page scrolling at this surface.
    canvas.addEventListener('wheel', zoom, { passive: false });
    return () => canvas.removeEventListener('wheel', zoom);
  }, []);

  useEffect(() => {
    const visible = sketch && visibleSketchPointIds(sketch, selected);
    const validSelected = selected.filter(id =>
      sketch?.entities.some(entity => entity.id === id && (entity.type !== 'point' || visible?.has(id)))
    );
    if (validSelected.length !== selected.length) setSelected(validSelected);
    const validConstraints = selectedConstraints.filter(
      id => id === dimensionDraft?.id || (!!sketch && associatedEntityIds(sketch, id).length > 0)
    );
    if (validConstraints.length !== selectedConstraints.length) setSelectedConstraints(validConstraints);
    if (partId !== (part?.id ?? '')) setPartId(part?.id ?? '');
    saveCadViewState(doc.id, { selectedPartId: part?.id ?? '', view, selectedEntityIds: validSelected });
  }, [doc.id, part, partId, selected, selectedConstraints, dimensionDraft, sketch, view]);

  useEffect(() => {
    if (!sketch) return;
    setDimensionFlow(previous =>
      previous.phase === 'idle' ? previous : transitionDimensionWorkflow(sketch, previous, { type: 'refresh' }).state
    );
  }, [sketch]);

  const publish = (next: CadDocument) => {
    setFinishError(null);
    documentRef.current = next;
    setDocument(next);
    callbacks.current.onDraftChange(next);
  };
  const commit = (next: CadDocument) => publish(commitCadSession(session, next));
  const changeSketch = (next: CadSketch) => part && commit(replacePart(documentRef.current, part.id, p => ({ ...p, sketch: next })));

  const solveDrag = async (moving: DragGesture) => {
    if (moving.working || (moving.failure && !moving.ended)) return;
    moving.working = true;
    const fail = (reason: string) => {
      moving.failure = `Drag cancelled. ${reason}`;
      moving.preview = moving.document;
      documentRef.current = moving.document;
      setDocument(moving.document);
      setDrawingCue(null);
      setSnapCue(null);
      setMessage(moving.failure);
    };
    try {
      // Keep only the latest pointer intent while the worker is busy.
      while (drag.current === moving && !moving.failure && moving.solvedRequest < moving.request) {
        const request = moving.request;
        const sourcePart = moving.document.parts.find(p => p.id === moving.partId)!;
        const source = sourcePart.sketch;
        const options: CadSolveOptions = {};
        if (moving.radiusEntityId) {
          const circle = source.entities.find(e => e.id === moving.radiusEntityId);
          const center = circle?.type === 'circle' ? source.entities.find(e => e.id === circle.centerId) : undefined;
          if (center?.type === 'point')
            options.radiusDrag = {
              entityId: moving.radiusEntityId,
              radius: Math.max(0.1, Math.hypot(moving.target.x - center.x, moving.target.y - center.y)),
            };
        } else
          options.drag = dragTargets(source, moving.selectedIds, {
            x: moving.target.x - moving.origin.x,
            y: moving.target.y - moving.origin.y,
          });
        const result = await solveCadDocument({ ...moving.document, parts: [sourcePart] }, options);
        if (drag.current !== moving) return;
        moving.solvedRequest = request;
        const restarted = result.diagnostics.find(diagnostic => diagnostic.code === 'solver-restarted');
        if (restarted) {
          fail(restarted.message);
          break;
        }
        if (result.sketches.length && result.sketches.every(s => s.status === 'solved')) {
          moving.preview = replacePart(moving.document, moving.partId, () => result.document.parts[0]!);
          documentRef.current = moving.preview;
          setDocument(moving.preview);
        }
      }
    } catch (error) {
      if (drag.current === moving) {
        const reason = error instanceof Error ? error.message : String(error);
        fail(`${reason} Your sketch is unchanged; try dragging again.`);
      }
    } finally {
      moving.working = false;
      if (drag.current === moving && moving.ended) {
        let accepted = moving.preview;
        let appliedAutomatic = false;
        if (!moving.failure && moving.snapPointId && moving.dropInference && moving.moved) {
          const previewPart = accepted.parts.find(part => part.id === moving.partId)!;
          const proposals = dragSnapConstraints(previewPart.sketch, moving.snapPointId, moving.dropInference, {
            project: projectPoint,
            tolerancePx: 1,
          });
          if (proposals.length) {
            let snapped = previewPart.sketch;
            for (const proposal of proposals) snapped = addConstraint(snapped, proposal);
            try {
              const result = await solveCadDocument({ ...accepted, parts: [{ ...previewPart, sketch: snapped }] });
              if (
                drag.current === moving &&
                result.sketches.every(state => state.status === 'solved') &&
                result.diagnostics.every(
                  diagnostic => diagnostic.severity !== 'error' || ['open-profile', 'empty-sketch'].includes(diagnostic.code)
                )
              ) {
                accepted = replacePart(accepted, moving.partId, () => result.document.parts[0]!);
                appliedAutomatic = true;
              } else if (drag.current === moving) {
                const restarted = result.diagnostics.find(diagnostic => diagnostic.code === 'solver-restarted');
                setMessage(
                  restarted
                    ? 'Point moved. The solver engine reset, so the automatic constraint was not applied. Try snapping the point again.'
                    : 'Point moved. The automatic constraint could not be applied; adjust the geometry and try again.'
                );
              }
            } catch (error) {
              if (drag.current === moving)
                setMessage(
                  `Point moved. The automatic constraint was not applied. ${error instanceof Error ? error.message : String(error)}`
                );
            }
          }
        }
        if (drag.current === moving) {
          drag.current = null;
          if (!moving.failure && (appliedAutomatic || hasDragMovement(moving.document, accepted))) commit(accepted);
          else {
            documentRef.current = moving.document;
            setDocument(moving.document);
            requestSketchCheck();
            setMessage(
              moving.failure ?? 'The current constraints keep this geometry in place. Edit a dimension or remove a constraint to move it.'
            );
          }
          setBusy(false);
          restoreCanvasKeyboard();
        }
      }
    }
  };

  useEffect(() => {
    if (finishing.current || drag.current || annotationDrag.current || lastCheckedRevision.current === `${doc.id}:${doc.revision}`) return;
    let cancelled = false;
    const sequence = ++solveSequence.current;
    setSolving(true);
    void solveCadDocument(doc, { classifyEntities: true })
      .then(result => {
        if (cancelled || sequence !== solveSequence.current || drag.current || annotationDrag.current) return;
        lastCheckedRevision.current = `${doc.id}:${doc.revision}`;
        setSolving(false);
        const feedback = sketchFeedback(result);
        setProblems(feedback.problems);
        setConflictedConstraints(feedback.conflictedConstraintIds);
        setInProgress(feedback.inProgress);
        setSketchStatuses(Object.fromEntries(result.sketches.map(state => [state.partId, state])));
        setStatus(feedback.status);
        // Solver normalization belongs to the same user command, never another undo entry.
        if (result.sketches.some(s => s.status === 'solved') && JSON.stringify(result.document) !== JSON.stringify(documentRef.current)) {
          session.document = result.document;
          documentRef.current = result.document;
          setDocument(result.document);
          callbacks.current.onDraftChange(result.document);
        }
      })
      .catch(error => {
        if (cancelled || sequence !== solveSequence.current) return;
        lastCheckedRevision.current = `${doc.id}:${doc.revision}`;
        setSolving(false);
        setProblems([error instanceof Error ? error.message : String(error)]);
        setInProgress(false);
        setStatus('Sketch could not be checked');
      });
    return () => {
      cancelled = true;
    };
  }, [doc, session, checkEpoch]);

  useEffect(() => {
    if (!dimension) return;
    dimensionInput.current?.focus();
    dimensionInput.current?.select();
  }, [dimension]);
  useEffect(() => {
    if (filletEditing) {
      filletInput.current?.focus();
      filletInput.current?.select();
    }
  }, [filletEditing]);
  useEffect(() => {
    if (conicEditing) {
      rhoInput.current?.focus();
      rhoInput.current?.select();
    }
  }, [conicEditing]);

  const cancelDimensionEdit = () => {
    const placed = dimension && !dimensionDraft;
    newDimensionCommand.current = null;
    setDimensionFlow(previous => idleDimensionWorkflow(previous.mode));
    setDimension(null);
    if (dimensionDraft) setSelectedConstraints(ids => ids.filter(id => id !== dimensionDraft.id));
    setMessage(
      placed
        ? 'Dimension value unchanged. Select geometry or choose a tool.'
        : 'Dimension creation cancelled. Select geometry or choose a tool.'
    );
    svg.current?.focus();
  };
  const selectDimension = (id: string, additive = false) => {
    newDimensionCommand.current = null;
    setDimensionFlow(previous => idleDimensionWorkflow(previous.mode));
    setDimension(null);
    setSelectedConstraints(ids => (additive ? (ids.includes(id) ? ids.filter(existing => existing !== id) : [...ids, id]) : [id]));
    setSelected([]);
    setMessage('Dimension selected. Double-click or press Enter to edit; Delete removes it.');
  };
  const editDimension = (id: string) => {
    newDimensionCommand.current = null;
    setDimensionFlow(previous => idleDimensionWorkflow(previous.mode));
    setSelectedConstraints([id]);
    setSelected([]);
    const constraint = sketch?.constraints.find(c => c.id === id);
    if (constraint && numeric(constraint) && constraint.driven) {
      setDimension(null);
      setMessage('Reference dimensions follow the geometry. Change it to driving from its context menu to edit the value.');
      svg.current?.focus();
      return;
    }
    setDimension(id);
    setMessage('Enter a dimension. Enter applies it; Escape cancels.');
  };
  const startAnnotationDrag = (id: string, event: PointerEvent<SVGGElement>) => {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || busy || solving || !sketch) return;
    const constraint = sketch.constraints.find(c => c.id === id);
    const matrix = svg.current?.getScreenCTM();
    const position = constraint && numeric(constraint) ? dimensionAnchor(constraint, sketch, markerScale) : null;
    if (!matrix || !position) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    event.preventDefault();
    selectDimension(id);
    annotationDrag.current = {
      id,
      document: documentRef.current,
      screenStart: { x: event.clientX, y: event.clientY },
      worldStart: { x: point.x, y: -point.y },
      position,
      moved: false,
    };
    // Keep fast drags/releases outside the canvas owned by this label, including ordinary double-clicks.
    event.currentTarget.setPointerCapture(event.pointerId);
    svg.current?.focus();
  };
  const chooseTool = (next: Tool) => {
    setContextMenu(null);
    contextPress.current = { phase: 'idle' };
    setCreationValues(null);
    drawingGesture.current = idleDrawingGesture();
    setConstraintMode(null);
    setDimension(null);
    setPalette(false);
    setFilletEditing(false);
    setConicEditing(null);
    setModification(idleModificationWorkflow());
    setHoveredModifyCurve(null);
    setModifyTarget(null);
    newCurveCommand.current = null;
    boxGesture.current = null;
    setSelectionBox(null);
    tangentAxis.current = null;
    hoveredReferences.current = [];
    lastDrawingHint.current = null;
    setDrawingCue(null);
    setSnapCue(null);
    newDimensionCommand.current = null;
    setSelectedConstraints([]);
    setHoveredConstraintEntities([]);
    setDimensionFlow(previous => idleDimensionWorkflow(previous.mode));
    if (next === 'line' && tool === 'arc' && contextualArc && lineContinuation && chain) {
      setTool('line');
      setContextualArc(false);
      setMessage('Click the next line endpoint, or press A to continue with an arc.');
      svg.current?.focus();
      return;
    }
    if (next === 'arc' && tool === 'line' && pending[0]) {
      const anchor = sketch && chainGeometry(sketch, chain);
      const start = anchor?.point ?? pending[0];
      setTool('arc');
      setContextualArc(true);
      setPending([{ x: start.x, y: start.y }]);
      setConstraintMode(null);
      setDimension(null);
      setPalette(false);
      setMessage('From the current endpoint: click the arc end, then a point on the arc.');
      svg.current?.focus();
      return;
    }
    if (next === 'tangentArc' && tool === 'tangentArc') {
      setTool('line');
      setMessage('Click the next line endpoint, or press Shift+A to continue with a tangent arc.');
      svg.current?.focus();
      return;
    }
    if (next === tool && next !== 'select') next = 'select';
    if (sketch && (next === 'offset' || next === 'mirror' || next === 'extend')) {
      setModification(beginModification(sketch, next, selected));
      setSelected(modificationSourceIds(sketch, selected, next));
    }
    if (next === 'tangentArc') {
      const anchor = sketch && chainGeometry(sketch, chain);
      if (!anchor || !lineContinuation) {
        setTool(next);
        setPending([]);
        setChain(null);
        setLineContinuation(false);
        setMessage('Click an endpoint of a line or arc, then click the tangent arc end.');
        svg.current?.focus();
        return;
      }
      setTool(next);
      setConstraintMode(null);
      setDimension(null);
      setPalette(false);
      setPending([{ x: anchor.point.x, y: anchor.point.y }]);
      setMessage('Click the end of the tangent arc. The line tool resumes automatically.');
      svg.current?.focus();
      return;
    }
    setTool(next);
    setContextualArc(false);
    setConstraintMode(null);
    setChain(null);
    pendingSnaps.current = [];
    setPending([]);
    setLineContinuation(false);
    setPalette(false);
    setDimension(null);
    setMessage(
      next === 'offset'
        ? 'Select curves to offset. Type a distance or press Enter to edit; click to place. Shift-click adds curves.'
        : next === 'mirror'
          ? selected.length
            ? 'Select the mirror line.'
            : 'Select entities, then choose Mirror line.'
          : next === 'extend'
            ? 'Select near the end to extend, then click its new end or a boundary.'
            : next === 'select'
              ? 'Click geometry to select. Drag to move. Shift-click adds to selection.'
              : next === 'rectangle' || next === 'centerRectangle'
                ? `Click or drag from the ${next === 'centerRectangle' ? 'center' : 'first corner'} to the opposite corner. Or enter sizes below.`
                : next === 'circle'
                  ? 'Click or drag from the center to a point on the circle. Or enter a radius below.'
                  : next === 'arc'
                    ? 'Click the start, end, then a point on the arc.'
                    : next === 'point'
                      ? 'Click to place a sketch point. Snap to endpoints, midpoints or curves, or place it freely.'
                      : next === 'line'
                        ? 'Click or drag from start to end. Lines continue from the last endpoint; Escape ends the chain.'
                        : next === 'trim'
                          ? 'Click an interval to trim between intersections or placed points.'
                          : next === 'fillet'
                            ? 'Select shared corner points or pairs of adjacent lines. Enter chooses the shared radius; Escape cancels.'
                            : next === 'conic'
                              ? 'Click the start, end, then control point. Enter rho to shape the conic.'
                              : next === 'spline' || next === 'bezier'
                                ? `Click ${next === 'spline' ? 'fit' : 'control'} points. Double-click the last point or press Enter to finish.`
                                : next === 'curveControlPoint'
                                  ? 'Click an open spline or a segment of a Bezier control polygon to add a point while preserving its shape.'
                                  : 'Select a line, circle, point pair or existing dimension.'
    );
    svg.current?.focus();
  };
  const navigateHistory = (redo = false) => {
    chooseTool('select');
    setSelected([]);
    publish(redo ? redoCadSession(session) : undoCadSession(session));
  };
  const fit = (entityIds?: readonly string[]) => {
    if (!sketch) return;
    const points = pointsOf(sketch);
    const included =
      entityIds &&
      new Set(
        entityIds.flatMap(id => {
          const entity = sketch.entities.find(e => e.id === id);
          return entity ? curvePointIds(entity) : [];
        })
      );
    const bounds = [...points.values()].filter(p => !included || included.has(p.id)).map(p => ({ x: p.x, y: p.y }));
    for (const e of sketch.entities)
      if ((!entityIds || entityIds.includes(e.id)) && (e.type === 'circle' || e.type === 'arc')) {
        const p = points.get(e.centerId);
        if (p) bounds.push({ x: p.x - e.radius, y: p.y - e.radius }, { x: p.x + e.radius, y: p.y + e.radius });
      }
    if (!bounds.length) return setView(initialView);
    const xmin = Math.min(...bounds.map(p => p.x)),
      xmax = Math.max(...bounds.map(p => p.x));
    const ymin = Math.min(...bounds.map(p => p.y)),
      ymax = Math.max(...bounds.map(p => p.y));
    const margin = 35;
    setView({ x: xmin - margin, y: -ymax - margin, w: Math.max(100, xmax - xmin + margin * 2), h: Math.max(80, ymax - ymin + margin * 2) });
  };
  const projectPoint = (point: Point) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: point.x, y: -point.y };
    const p = new DOMPoint(point.x, -point.y).matrixTransform(matrix);
    return { x: p.x, y: p.y };
  };
  const pointAt = (event: { clientX: number; clientY: number; shiftKey?: boolean }): Point => {
    const matrix = svg.current?.getScreenCTM();
    lastSnap.current = null;
    lastDrawingHint.current = null;
    inference.current = null;
    tangentAxis.current = null;
    if (!matrix) return cursor;
    const converted = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const raw = { x: converted.x, y: -converted.y };
    const drawing = ['line', 'rectangle', 'centerRectangle', 'circle', 'arc', 'tangentArc', 'point', 'conic', 'spline', 'bezier'].includes(
      tool
    );
    if (!snap || !sketch || (drawing && event.shiftKey)) return raw;
    const hit = pickSketchSnap(
      sketch,
      { x: event.clientX, y: event.clientY },
      { project: projectPoint, excludePointIds: drag.current?.points, selectedEntityIds: dimensionSelection }
    );
    lastSnap.current = hit;
    let point = hit?.point ?? raw;
    const lockedAxes: { x?: number; y?: number } = {};
    if (tool === 'line' && pending[0]) {
      const anchor = lineContinuation ? chainGeometry(sketch, chain) : null;
      const start = anchor?.point ?? pending[0];
      const scale = Math.hypot(matrix.a, matrix.b);
      const dx = point.x - start.x,
        dy = point.y - start.y;
      if (anchor?.curve.type === 'arc') {
        const length = Math.hypot(anchor.tangent.x, anchor.tangent.y);
        const unit = { x: anchor.tangent.x / length, y: anchor.tangent.y / length };
        const along = dx * unit.x + dy * unit.y;
        const perpendicular = Math.abs(dx * unit.y - dy * unit.x);
        if (along > 0 && perpendicular * scale <= 8 && Math.atan2(perpendicular, along) <= Math.PI / 30 && (!hit || perpendicular < 1e-7)) {
          point = { x: start.x + along * unit.x, y: start.y + along * unit.y };
          inference.current = 'tangent';
          tangentAxis.current = tangentLineAxis(anchor.tangent, start, raw, scale);
          if (tangentAxis.current === 'horizontal') {
            point.y = start.y;
            lockedAxes.y = start.y;
          } else if (tangentAxis.current === 'vertical') {
            point.x = start.x;
            lockedAxes.x = start.x;
          } else {
            lockedAxes.x = point.x;
            lockedAxes.y = point.y;
          }
        }
      }
      if (!inference.current && Math.hypot(dx, dy) * scale > 8) {
        if (Math.abs(dy) * scale <= 8 && (!hit || Math.abs(dy) < 1e-7)) {
          point = { x: point.x, y: start.y };
          inference.current = 'horizontal';
          lockedAxes.y = start.y;
        } else if (Math.abs(dx) * scale <= 8 && (!hit || Math.abs(dx) < 1e-7)) {
          point = { x: start.x, y: point.y };
          inference.current = 'vertical';
          lockedAxes.x = start.x;
        }
      }
    }
    if (drawing) {
      if (hit?.targetPointId)
        hoveredReferences.current = [hit.targetPointId, ...hoveredReferences.current.filter(id => id !== hit.targetPointId)].slice(0, 4);
      const startId =
        lineContinuation && chain
          ? chain.pointId
          : pending[0] && sketch.entities.find(e => e.type === 'point' && Math.hypot(e.x - pending[0]!.x, e.y - pending[0]!.y) < 1e-7)?.id;
      const result = inferDrawingPoint(sketch, raw, {
        project: projectPoint,
        directSnap: hit,
        lockedAxes,
        preferredPointIds: hoveredReferences.current,
        excludePointIds: [...(drag.current?.points ?? []), ...(tool === 'line' && startId && inference.current ? [startId] : [])],
      });
      point = { ...result.point };
      // Grid rounding is only a fallback; it must never manufacture a constraint inside a pixel tolerance.
      if (!hit) {
        if (lockedAxes.x === undefined && !result.alignments.some(a => a.type === 'verticalPoints')) point.x = Math.round(point.x);
        if (lockedAxes.y === undefined && !result.alignments.some(a => a.type === 'horizontalPoints')) point.y = Math.round(point.y);
      }
      lastDrawingHint.current = { ...result, point, guides: result.guides.map(g => ({ ...g, to: point })) };
    } else if (!hit) point = { x: Math.round(raw.x), y: Math.round(raw.y) };
    return point;
  };
  const addSnapRelations = (source: CadSketch, hints: (CadDrawingInference | null)[], curvePointIndex = -1) => {
    let next = source;
    const createdCurve = source.entities.find(
      e => (e.type === 'circle' || e.type === 'arc') && !sketch?.entities.some(before => before.id === e.id)
    );
    for (const [index, inference] of hints.entries()) {
      if (!inference || (!inference.snap && !inference.alignments.length)) continue;
      const hint = inference.snap;
      const candidates = next.entities.filter(
        (e): e is SketchPoint => e.type === 'point' && Math.hypot(e.x - inference.point.x, e.y - inference.point.y) < 1e-7
      );
      let point: SketchPoint | undefined = candidates.find(e => !sketch?.entities.some(before => before.id === e.id)) ?? candidates[0];
      if (index === curvePointIndex && createdCurve) {
        // A circle's rim / arc's through click needs a concrete construction point to retain its inferred intent.
        if (!point) {
          next = addPoint(next, { ...inference.point, construction: true, standalone: false });
          point = next.entities.find(
            (e): e is SketchPoint => e.type === 'point' && Math.hypot(e.x - inference.point.x, e.y - inference.point.y) < 1e-7
          );
        }
        const pointId = point?.id;
        if (pointId && !next.constraints.some(c => c.type === 'pointOnCircle' && c.pointId === pointId && c.entityId === createdCurve.id))
          next = addConstraint(next, { type: 'pointOnCircle', pointId, entityId: createdCurve.id });
      }
      if (point) for (const relation of inferredPointConstraints(inference, point.id, next)) next = addConstraint(next, relation);
      if (point && hint?.targetPointId && point.id !== hint.targetPointId) {
        if (
          !next.constraints.some(
            c =>
              c.type === 'coincident' &&
              [c.pointAId, c.pointBId].includes(point.id) &&
              [c.pointAId, c.pointBId].includes(hint.targetPointId!)
          )
        )
          next = addConstraint(next, { type: 'coincident', pointAId: point.id, pointBId: hint.targetPointId });
        continue;
      }
      if (!hint?.intent) continue;
      const curve = sketch?.entities.find(e => e.id === hint.intent!.entityId);
      if (!point || !curve) continue;
      const type =
        hint.intent.type === 'midpoint'
          ? 'midpoint'
          : curve.type === 'line'
            ? 'pointOnLine'
            : curve.type === 'circle' || curve.type === 'arc'
              ? 'pointOnCircle'
              : 'pointOnCurve';
      if (
        !next.constraints.some(
          c => c.type === type && 'pointId' in c && c.pointId === point.id && 'entityId' in c && c.entityId === curve.id
        )
      )
        next =
          type === 'pointOnCurve'
            ? addConstraint(next, { type, pointId: point.id, entityId: curve.id, parameter: hint.parameter ?? 0.5 })
            : addConstraint(next, { type, pointId: point.id, entityId: curve.id });
    }
    return next;
  };
  const addShape = (end?: Point) => {
    if (!sketch || !pending[0]) return;
    const anchor = lineContinuation ? chainGeometry(sketch, chain) : null;
    const start = anchor?.point ?? pending[0];
    let next = sketch;
    const sizeExpressions: Record<string, string | undefined> = {};
    let continued: ChainAnchor | null = null;
    let actualEnd = end;
    if (tool === 'rectangle' || tool === 'centerRectangle') {
      const centered = tool === 'centerRectangle';
      const widthValue = end ? null : parseCadValue(width, { unit: 'mm' });
      const heightValue = end ? null : parseCadValue(height, { unit: 'mm' });
      if (widthValue && 'error' in widthValue) return setMessage(`Rectangle width: ${widthValue.error}`);
      if (heightValue && 'error' in heightValue) return setMessage(`Rectangle height: ${heightValue.error}`);
      const w = end ? (end.x - start.x) * (centered ? 2 : 1) : widthValue!.value;
      const h = end ? (end.y - start.y) * (centered ? 2 : 1) : heightValue!.value;
      if (!end && (w <= 0 || h <= 0)) return setMessage('Rectangle width and height must be greater than zero.');
      if (!Number.isFinite(w) || !Number.isFinite(h) || Math.abs(w) < 0.1 || Math.abs(h) < 0.1)
        return setMessage('Width and height must be greater than zero.');
      next = (centered ? addCenterRectangle : addRectangle)(sketch, {
        x: centered ? start.x : Math.min(start.x, start.x + w),
        y: centered ? start.y : Math.min(start.y, start.y + h),
        width: Math.abs(w),
        height: Math.abs(h),
        construction,
        dimensioned: end === undefined,
      });
      if (!end) {
        sizeExpressions.Width = widthValue?.expression;
        sizeExpressions.Height = heightValue?.expression;
      }
    } else if (tool === 'circle') {
      const radiusValue = end ? null : parseCadValue(radius, { unit: 'mm' });
      if (radiusValue && 'error' in radiusValue) return setMessage(`Circle radius: ${radiusValue.error}`);
      const r = end ? Math.hypot(end.x - start.x, end.y - start.y) : radiusValue!.value;
      if (!Number.isFinite(r) || r < 0.1) return setMessage('Radius must be greater than zero.');
      next = addCircle(sketch, { ...start, radius: r, construction, dimensioned: end === undefined });
      if (!end && radiusValue?.expression) sizeExpressions.Diameter = `2*(${radiusValue.expression})`;
    } else if (tool === 'line' && end) {
      if (Math.hypot(end.x - start.x, end.y - start.y) < 0.1) return;
      next = addLine(sketch, { x1: start.x, y1: start.y, x2: end.x, y2: end.y, construction });
      const line = next.entities.at(-1);
      if (line?.type === 'line') {
        continued = { pointId: line.endId, curveId: line.id };
        if (inference.current === 'horizontal' || inference.current === 'vertical')
          next = addConstraint(next, { type: inference.current, entityId: line.id });
        else if (inference.current === 'tangent' && anchor) {
          next = addConstraint(next, { type: 'tangent', entityAId: anchor.curve.id, entityBId: line.id });
          if (tangentAxis.current) next = addConstraint(next, { type: tangentAxis.current, entityId: line.id });
        }
      }
    } else if (tool === 'tangentArc' && anchor && end) {
      const arc = tangentArcFrom(anchor.point, anchor.tangent, end);
      if (!arc) return setMessage('Choose an arc endpoint away from its tangent line.');
      next = addArc(sketch, { ...arc, construction });
      const created = next.entities.at(-1);
      if (created?.type === 'arc') {
        next = addConstraint(next, { type: 'tangent', entityAId: anchor.curve.id, entityBId: created.id });
        const endId = pointEquivalence(next.constraints).equivalent(created.startId, anchor.point.id) ? created.endId : created.startId;
        continued = { pointId: endId, curveId: created.id };
      }
      setTool('line');
      setMessage('Click the next line endpoint, or Shift+A for another tangent arc.');
    } else if (tool === 'conic' && pending[1] && end) {
      try {
        const parsedRho = parseCadValue(rho, { unit: 'scalar' });
        if ('error' in parsedRho) return setMessage(`Conic rho: ${parsedRho.error}`);
        next = addConic(sketch, { start, end: pending[1], control: end, rho: parsedRho.value, construction });
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : String(error));
      }
    } else if (tool === 'arc' && pending[1] && end) {
      const arc = threePointArc(start, pending[1], end);
      if (!arc || arc.radius < 0.1) return setMessage('Three points on the arc must not lie on one straight line.');
      next = addArc(sketch, { ...arc, construction });
      if (contextualArc) {
        const created = next.entities.at(-1);
        const gestureEnd = pending[1];
        if (created?.type === 'arc') {
          const point = next.entities.find(
            (e): e is SketchPoint =>
              e.type === 'point' &&
              [created.startId, created.endId].includes(e.id) &&
              Math.hypot(e.x - gestureEnd.x, e.y - gestureEnd.y) < 1e-7
          );
          if (point) continued = { pointId: point.id, curveId: created.id };
          actualEnd = gestureEnd;
        }
      }
    } else return;
    if (Object.values(sizeExpressions).some(Boolean))
      next = {
        ...next,
        constraints: next.constraints.map(c =>
          !sketch.constraints.some(before => before.id === c.id) && c.label && sizeExpressions[c.label]
            ? { ...c, expression: sizeExpressions[c.label] }
            : c
        ),
      };
    const hints = end ? [...pendingSnaps.current, lastDrawingHint.current] : pendingSnaps.current;
    next = addSnapRelations(next, hints, end && (tool === 'circle' || tool === 'arc') ? hints.length - 1 : -1);
    changeSketch(next);
    drawingGesture.current = idleDrawingGesture();
    if (tool === 'conic') {
      const curve = next.entities.find(entity => entity.type === 'conic' && !sketch.entities.some(before => before.id === entity.id));
      if (curve?.type === 'conic') {
        newCurveCommand.current = { id: curve.id, checkpoint: cadCommandCheckpoint(session) };
        setConicEditing(curve.id);
        setRho(String(curve.rho));
      }
    }
    setDrawingCue(null);
    setSnapCue(null);
    setChain(continued);
    setPending(continued && actualEnd ? [actualEnd] : []);
    setLineContinuation(!!continued);
    pendingSnaps.current = [];
    const added = next.entities.filter(e => !sketch.entities.some(before => before.id === e.id) && e.type !== 'point');
    setCreationValues(
      end && part
        ? beginCreationValues(
            tool,
            part.id,
            next,
            added.map(entity => entity.id),
            end
          )
        : null
    );
    setSelected(
      added
        .filter(
          e =>
            tool !== 'centerRectangle' ||
            next.constraints.some(
              c => ['horizontal', 'vertical', 'parallel', 'perpendicular'].includes(c.type) && constraintEntityIds(c).includes(e.id)
            )
        )
        .map(e => e.id)
    );
    // Passive measured values leave shortcuts live; numeric typing turns them into drivers.
    setDimension(null);
    svg.current?.focus();
  };
  const currentDimension = dimensionDraft?.id === dimension ? dimensionDraft : sketch?.constraints.find(c => c.id === dimension);
  const rejectValue = (reason: string, input?: HTMLInputElement | null) => {
    setMessage(reason);
    input?.focus();
    return reason;
  };
  const applyDimensionValue = (): string | null => {
    if (!currentDimension || !numeric(currentDimension)) return null;
    const input = dimensionInput.current;
    if (!input?.value.trim()) return rejectValue('Enter a dimension value.', input);
    const parsed = parseCadValue(input.value, { unit: currentDimension.type === 'angle' ? 'deg' : 'mm' });
    if ('error' in parsed) return rejectValue(parsed.error, input);
    const valueError = dimensionValueError(currentDimension, parsed.value);
    if (valueError) return rejectValue(valueError, input);
    const next = updateDimension(documentRef.current, currentDimension.id, parsed.value, parsed.expression);
    const command = newDimensionCommand.current;
    const amended = command?.id === currentDimension.id ? amendCadSession(session, next, command.checkpoint) : null;
    if (amended) publish(amended);
    else commit(next);
    newDimensionCommand.current = null;
    setDimension(null);
    setMessage('Dimension applied. Select geometry or choose a tool.');
    svg.current?.focus();
    return null;
  };
  const applyCreationValue = ({ advance = true } = {}): string | null => {
    if (!creationValues || !part || !sketch || creationValues.partId !== part.id) return null;
    const current = creationValueAt(creationValues, sketch);
    if (!current) return rejectValue('This drawing value no longer applies. Select its geometry again.', creationInput.current);
    const parsed = parseCadValue(
      creationValues.editing ? (creationInput.current?.value ?? creationValues.text) : String(current.constraint.value),
      { unit: 'mm' }
    );
    if ('error' in parsed) return rejectValue(parsed.error, creationInput.current);
    const valueError = dimensionValueError(current.constraint, parsed.value);
    if (valueError) return rejectValue(valueError, creationInput.current);
    if (current.existingConstraintId)
      commit(updateDimension(documentRef.current, current.existingConstraintId, parsed.value, parsed.expression));
    else {
      const constraint = { ...current.constraint, value: parsed.value, expression: parsed.expression };
      const position = creationValueAnchor(creationValues, sketch, creationValues.index, markerScale);
      changeSketch(addConstraint(sketch, position ? withDimensionPlacement(sketch, constraint, position) : constraint));
    }
    setCreationValues(advance ? advanceCreationValue(creationValues) : null);
    setMessage('Drawing dimension applied. Type the next value or keep drawing.');
    svg.current?.focus();
    return null;
  };
  const finishSpline = (keepTool = false) => {
    if (!sketch || (tool !== 'spline' && tool !== 'bezier') || pending.length < 2) return;
    try {
      let next = (tool === 'spline' ? addSpline : addBezier)(sketch, { points: pending, construction });
      next = addSnapRelations(next, pendingSnaps.current);
      const curve = next.entities.find(entity => entity.type === tool && !sketch.entities.some(before => before.id === entity.id));
      changeSketch(next);
      chooseTool('select');
      if (keepTool) setTool(tool);
      setSelected(curve ? [curve.id] : []);
      setMessage(`${tool === 'spline' ? 'Spline' : 'Bezier'} created. Drag its visible points to edit the curve.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const acceptFillet = () => {
    if (!filletPreview?.ok) {
      setMessage(
        filletPreview && !filletPreview.ok
          ? filletPreview.message
          : filletSelection && !filletSelection.ok
            ? filletSelection.message
            : 'Select corners to fillet.'
      );
      return;
    }
    const radiusId = filletPreview.radiusConstraintId;
    const parsed = parseCadValue(filletRadius, { unit: 'mm' });
    const next =
      'value' in parsed && parsed.expression
        ? {
            ...filletPreview.sketch,
            constraints: filletPreview.sketch.constraints.map(c => (c.id === radiusId ? { ...c, expression: parsed.expression } : c)),
          }
        : filletPreview.sketch;
    changeSketch(next);
    chooseTool('select');
    setSelected([]);
    setSelectedConstraints([radiusId]);
    setMessage('Fillets created. Double-click the shared radius to edit the group.');
  };
  const acceptOffset = (): string | null => {
    if (modification.phase !== 'offset' || !modification.entityIds.length) return null;
    if (!offsetPreview?.ok) return rejectValue(offsetPreview?.message ?? 'Select curves to offset.', offsetInput.current);
    const parsed = parseCadValue(modification.text, { unit: 'mm' });
    const next =
      'value' in parsed && parsed.expression
        ? {
            ...offsetPreview.sketch,
            constraints: offsetPreview.sketch.constraints.map(c =>
              c.id === offsetPreview.dimensionId ? { ...c, expression: parsed.expression } : c
            ),
          }
        : offsetPreview.sketch;
    changeSketch(next);
    setModification(previous => transitionModification(previous, { type: 'complete' }));
    setSelected([]);
    setMessage('Offset created. Double-click its dimension to edit; select more curves to offset again.');
    svg.current?.focus();
    return null;
  };
  const applyConicRho = (): string | null => {
    if (!sketch || !part || !conicEditing) return null;
    try {
      const parsed = parseCadValue(rhoInput.current?.value ?? rho, { unit: 'scalar' });
      if ('error' in parsed) return rejectValue(`Conic rho: ${parsed.error}`, rhoInput.current);
      const next = replacePart(documentRef.current, part.id, current => ({
        ...current,
        sketch: setConicRho(current.sketch, conicEditing, parsed.value),
      }));
      const command = newCurveCommand.current;
      const amended = command?.id === conicEditing ? amendCadSession(session, next, command.checkpoint) : null;
      if (amended) publish(amended);
      else commit(next);
      const curveId = conicEditing;
      chooseTool('select');
      setSelected([curveId]);
      setMessage('Conic applied. Drag its control point to reshape it.');
      return null;
    } catch (error) {
      return rejectValue(error instanceof Error ? error.message : String(error), rhoInput.current);
    }
  };
  const removeSelected = (entityIds: readonly string[] = selected, constraintIds: readonly string[] = selectedConstraints) => {
    if (tool === 'fillet' && selected.length) {
      chooseTool('select');
      setSelected([]);
      return;
    }
    if (dimensionFlow.phase !== 'idle') {
      cancelDimensionEdit();
      return;
    }
    if (!sketch) return;
    if (!constraintIds.length && entityIds.length && entityIds.every(id => isSplineTangentHandle(sketch, id))) {
      setMessage('Spline tangent handles cannot be deleted individually. Select the curve to delete it.');
      return;
    }
    let next = sketch;
    if (constraintIds.length) {
      constraintIds.forEach(id => {
        next = removeInlineConstraint(next, id);
      });
      setSelectedConstraints([]);
      setDimension(null);
    }
    // Protection belongs to the command's original graph, even if deleting its
    // parent first leaves a handle point in use by an unselected curve.
    entityIds
      .filter(id => !isSplineTangentHandle(sketch, id))
      .forEach(id => {
        next = removeEntity(next, id);
      });
    const remainingIds = new Set(next.entities.map(entity => entity.id));
    const missing = (id: string | undefined) => !!id && !remainingIds.has(id);
    const lostChain = chain && (missing(chain.curveId) || missing(chain.pointId));
    const lostPendingReference = pendingSnaps.current.some(
      hint =>
        hint &&
        (missing(hint.snap?.targetPointId) ||
          missing(hint.snap?.entityId) ||
          missing(hint.snap?.intent?.entityId) ||
          hint.alignments.some(alignment => missing(alignment.sourcePointId)))
    );
    if (lostChain || lostPendingReference) chooseTool('select');
    if (sketch.entities.some(entity => !remainingIds.has(entity.id))) {
      setHoveredPoint(null);
      setSnapCue(null);
      setDrawingCue(null);
      hoveredReferences.current = [];
      lastSnap.current = null;
      lastDrawingHint.current = null;
      inference.current = null;
      tangentAxis.current = null;
    }
    changeSketch(next);
    setSelected([]);
    setHoveredConstraintEntities([]);
    svg.current?.focus();
  };
  const openContext = (target: SketchContextTarget, position: Point) => {
    if (!sketch || busy || drag.current || annotationDrag.current) return;
    const context = createSketchContext(sketch, target, position, { entityIds: dimensionSelection, constraintIds: selectedConstraints });
    chooseTool('select');
    setSelected([...context.entityIds]);
    setSelectedConstraints([...context.constraintIds]);
    setContextMenu(context);
  };
  const contextTarget = (target: Element, position: Point) =>
    sketch
      ? target.closest('[data-constraint-id]')
        ? ({ kind: 'blank' } as const)
        : pickSketchContextTarget(sketch, position, {
            project: projectPoint,
            selectedEntityIds: dimensionSelection,
            targetDimensionId: target.closest('[data-dimension]')?.getAttribute('data-dimension') ?? undefined,
            targetEntityId: target.closest('[data-entity-id]')?.getAttribute('data-entity-id') ?? undefined,
          })
      : ({ kind: 'blank' } as const);
  const keyboardContext = () => {
    if (!sketch || !svg.current) return;
    const target = selectedSketchContextTarget(sketch, { entityIds: dimensionSelection, constraintIds: selectedConstraints });
    const element =
      target.kind === 'blank'
        ? svg.current
        : (svg.current.querySelector(`[${target.kind === 'dimension' ? 'data-dimension' : 'data-entity-id'}="${CSS.escape(target.id)}"]`) ??
          svg.current);
    const bounds = element.getBoundingClientRect();
    openContext(target, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  };
  const contextAction = (action: SketchContextAction, context: SketchContext) => {
    if (!sketch) return;
    if (action === 'fit') fit();
    else if (action === 'fit-selection') fit(context.entityIds);
    else if (action === 'clear') {
      setSelected([]);
      setSelectedConstraints([]);
      setHoveredConstraintEntities([]);
    } else if (action === 'construction') changeSketch(toggleContextConstruction(sketch, context.entityIds));
    else if (action === 'delete-entities' || action === 'delete-dimensions') removeSelected(context.entityIds, context.constraintIds);
    else if (context.target.kind === 'dimension') {
      const id = context.target.id,
        constraint = sketch.constraints.find(c => c.id === id);
      if (action === 'edit-dimension') editDimension(id);
      else if (constraint && numeric(constraint)) {
        commit(setDimensionDriven(documentRef.current, id, !constraint.driven));
        setDimension(null);
        setMessage(constraint.driven ? 'Dimension is driving the geometry.' : 'Reference dimension follows the geometry.');
      }
    }
  };
  const placeDimension = async (placed: CadDimension) => {
    if (!part || busy || preparingDimension.current) return;
    const source = documentRef.current;
    const snapshot = JSON.stringify(source);
    preparingDimension.current = true;
    setBusy(true);
    try {
      const result = await prepareDimensionCreation(part, placed);
      if (!mounted.current) return;
      if (JSON.stringify(documentRef.current) !== snapshot) {
        setMessage('The sketch changed while the dimension was checked. Select geometry again.');
        return;
      }
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      commit(replacePart(source, part.id, () => result.part));
      setSelectedConstraints([placed.id]);
      if (result.driven) {
        setDimension(null);
        setMessage('Reference dimension created. Existing constraints already determine this measurement.');
        svg.current?.focus();
      } else {
        newDimensionCommand.current = { id: placed.id, checkpoint: cadCommandCheckpoint(session) };
        setDimension(placed.id);
        setMessage('Enter a dimension. Enter applies it; Escape cancels.');
      }
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      preparingDimension.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const applyDimensionEvent = (event: DimensionWorkflowEvent) => {
    if (!sketch) return;
    const transition = transitionDimensionWorkflow(sketch, dimensionFlow, event);
    setDimensionFlow(transition.state);
    if (transition.message) setMessage(transition.message);
    if (transition.effect?.type === 'edit-existing') {
      editDimension(transition.effect.constraintId);
      return;
    }
    if (transition.effect?.type === 'create') {
      const placed = transition.effect.constraint;
      if (!constraintEntityIds(placed).every(id => sketch.entities.some(entity => entity.id === id))) {
        cancelDimensionEdit();
        setMessage('The dimension geometry changed. Select geometry again to create a dimension.');
        return;
      }
      void placeDimension(placed);
    }
  };
  const beginDimension = () => {
    chooseTool('dimension');
    if (tool === 'dimension' || !sketch) return;
    const transition = transitionDimensionWorkflow(sketch, idleDimensionWorkflow(dimensionMode), {
      type: 'begin',
      entityIds: selected,
      previewId: newCadId(),
      pickHints: selectionHints.current,
    });
    setDimensionFlow(transition.state);
    setSelected([]);
    if (transition.message) setMessage(transition.message);
    svg.current?.focus();
  };
  const constrain = (type: ConstraintTool) => {
    if (!sketch) return;
    const references = [...dimensionSelection];
    // Constraint commands replace drawing/dimension placement just like the other sketch tools.
    chooseTool('select');
    setSelected(references);
    if (constraintMode === type) {
      setConstraintMode(null);
      setSelected([]);
      setMessage('Click geometry to select. Drag to move. Shift-click adds to selection.');
      svg.current?.focus();
      return;
    }
    const result = buildConstraintForSelection(sketch, type, references);
    if (result.constraint) {
      changeSketch(addConstraint(sketch, result.constraint));
      setConstraintMode(null);
      setMessage(result.message);
    } else if (result.alreadyApplied) {
      setConstraintMode(null);
      setMessage(result.message);
    } else {
      setConstraintMode(type);
      setMessage(result.message);
      if (!result.needsMore) setSelected([]);
    }
  };
  const toggleFix = () => {
    if (!sketch) return;
    const ids = new Set(
      selected.flatMap(id => {
        const entity = sketch.entities.find(e => e.id === id);
        return entity ? entityPointIds(entity) : [];
      })
    );
    ids.delete(originId(sketch));
    if (!ids.size) return setMessage('Select geometry to fix. The origin always stays fixed.');
    const shouldFix = sketch.entities.some(e => e.type === 'point' && ids.has(e.id) && !e.fixed);
    changeSketch({ ...sketch, entities: sketch.entities.map(e => (e.type === 'point' && ids.has(e.id) ? { ...e, fixed: shouldFix } : e)) });
    setMessage(shouldFix ? 'Selected geometry fixed. Shift+J unfixes it.' : 'Selected geometry unfixed.');
  };
  const toggleConstruction = () => {
    if (sketch && selected.length) {
      const next = toggleContextConstruction(sketch, selected);
      if (next === sketch)
        setMessage('Spline tangent handles remain construction geometry. Select the curve to change its construction state.');
      else changeSketch(next);
    } else setConstruction(value => !value);
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keep native input and button events functional; prevent machine/global bubble handlers from seeing CAD keys.
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || editable(event.target)) return;
    const key = event.key.toLowerCase();
    // A checkbox does not own drawing letters, but retains its native keyboard
    // activation and focus. Text fields remain isolated by the guard above.
    if (event.target instanceof HTMLInputElement && event.target.type === 'checkbox' && (key === ' ' || key === 'enter')) return;
    if (key === 'shift') {
      setDrawingCue(null);
      setSnapCue(null);
      return;
    }
    if (
      drag.current ||
      annotationDrag.current ||
      boxGesture.current?.moved ||
      (drawingGesture.current.phase === 'pressed' && drawingGesture.current.moved)
    ) {
      event.preventDefault();
      if (key === 'escape') pointerEnd(true);
      return;
    }
    if (boxGesture.current) {
      boxGesture.current = null;
      setSelectionBox(null);
    }
    if (busy) return;
    if ((key === ' ' || key === 'enter') && event.target instanceof HTMLElement && event.target.closest('button,a')) return;
    if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) {
      event.preventDefault();
      navigateHistory(key === 'y' || event.shiftKey);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'a') {
      event.preventDefault();
      setSelected(sketch?.entities.filter(e => e.type !== 'point').map(e => e.id) ?? []);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (modification.phase === 'offset' && modification.entityIds.length) {
      if (/^[0-9.,-]$/.test(key)) {
        event.preventDefault();
        setModification(previous => transitionModification(previous, { type: 'text', text: key }));
        return;
      }
      if (key === 'enter') {
        event.preventDefault();
        setModification(previous => transitionModification(previous, { type: 'edit' }));
        return;
      }
    }
    if (key === 'enter' && modification.phase === 'mirror' && modification.entityIds.length) {
      event.preventDefault();
      setModification(previous => transitionModification(previous, { type: 'mirrorPicking', picking: 'axis' }));
      setMessage('Select the mirror line.');
      return;
    }
    if (key === 'escape' && modification.phase !== 'idle') {
      event.preventDefault();
      chooseTool('select');
      setSelected([]);
      return;
    }
    if (key === 'contextmenu' || (event.shiftKey && key === 'f10')) {
      event.preventDefault();
      keyboardContext();
      return;
    }
    if (creationValues && part?.id === creationValues.partId && sketch && creationValueAt(creationValues, sketch)) {
      if (/^[0-9.,-]$/.test(key)) {
        event.preventDefault();
        setCreationValues({ ...creationValues, editing: true, text: key, selectAll: false });
        return;
      }
      if (key === 'enter') {
        event.preventDefault();
        applyCreationValue();
        return;
      }
      if (key === 'escape') setCreationValues(null);
    }
    if (event.shiftKey && key === 'a') {
      event.preventDefault();
      chooseTool('tangentArc');
      return;
    }
    if (event.shiftKey && key === 'f') {
      event.preventDefault();
      chooseTool('fillet');
      return;
    }
    if (event.shiftKey && key === 's') {
      event.preventDefault();
      chooseTool('point');
      return;
    }
    if (event.shiftKey && key === 'm') {
      event.preventDefault();
      constrain('midpoint');
      return;
    }
    if (event.shiftKey && key === 'j') {
      event.preventDefault();
      toggleFix();
      return;
    }
    const constraintKey =
      event.shiftKey && key === 'l'
        ? 'perpendicular'
        : !event.shiftKey
          ? (
              { h: 'horizontal', v: 'vertical', i: 'coincident', e: 'equal', b: 'parallel', t: 'tangent' } as Record<string, ConstraintTool>
            )[key]
          : undefined;
    if (constraintKey) {
      event.preventDefault();
      constrain(constraintKey);
      return;
    }
    if (key === 'escape') {
      event.preventDefault();
      if (dimensionFlow.phase !== 'idle' || dimension) {
        cancelDimensionEdit();
        return;
      }
      if ((tool === 'spline' || tool === 'bezier') && pending.length >= 2) {
        finishSpline(true);
        return;
      }
      if (pending.length) {
        drawingGesture.current = idleDrawingGesture();
        setPending([]);
        setLineContinuation(false);
        setChain(null);
        setDrawingCue(null);
        setSnapCue(null);
        hoveredReferences.current = [];
      } else {
        chooseTool('select');
        setSelected([]);
      }
    } else if (key === 'enter' && tool === 'fillet') {
      event.preventDefault();
      if (filletPreview?.ok) setFilletEditing(true);
      else setMessage(filletPreview && !filletPreview.ok ? filletPreview.message : 'Select shared corner points or adjacent lines.');
    } else if (key === 'enter' && (tool === 'spline' || tool === 'bezier')) {
      event.preventDefault();
      finishSpline();
    } else if (key === 'enter' && selectedConstraints.length === 1) {
      const c = sketch?.constraints.find(c => c.id === selectedConstraints[0]);
      if (c && numeric(c)) {
        event.preventDefault();
        editDimension(c.id);
      }
    } else if (key === ' ') {
      event.preventDefault();
      setSelected([]);
      setDimensionFlow(previous => idleDimensionWorkflow(previous.mode));
      setSelectedConstraints([]);
      setHoveredConstraintEntities([]);
    } else if (key === 'delete' || key === 'backspace') {
      event.preventDefault();
      removeSelected();
    } else if (key === 'q') {
      event.preventDefault();
      toggleConstruction();
    } else if (key === 's') {
      event.preventDefault();
      setPalette(value => !value);
    } else if (key === 'f') {
      event.preventDefault();
      fit();
    } else if (key === 'd') {
      event.preventDefault();
      beginDimension();
    } else {
      const command = tools.find(t => t.key?.toLowerCase() === key)?.id;
      if (command) {
        event.preventDefault();
        chooseTool(command);
      }
    }
  };
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (busy) return;
    svg.current?.focus();
    if (event.button === 1 || event.button === 2) {
      event.preventDefault();
      if (event.button === 2)
        contextPress.current = transitionSketchContextPress(contextPress.current, {
          type: 'press',
          pointerId: event.pointerId,
          position: { x: event.clientX, y: event.clientY },
          target: contextTarget(event.target as Element, { x: event.clientX, y: event.clientY }),
        }).state;
      pan.current = { x: event.clientX, y: event.clientY, view };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0 || !sketch) return;
    setCreationValues(null);
    if (conicEditing) {
      setConicEditing(null);
      newCurveCommand.current = null;
    }
    const p = pointAt(event);
    const target = event.target as Element;
    if (target.closest('[data-dimension]')) return;
    if (target.closest('[data-constraint-id]')) return;
    if (!event.shiftKey) setSelectedConstraints([]);
    const directEntityId = target.closest('[data-entity-id]')?.getAttribute('data-entity-id') ?? undefined;
    const pointHit = pickSketchPoint(
      sketch,
      { x: event.clientX, y: event.clientY },
      { project: projectPoint, selectedEntityIds: dimensionSelection, preferredPointId: directEntityId }
    );
    const curveHit = pointHit
      ? null
      : pickSketchSnap(
          sketch,
          { x: event.clientX, y: event.clientY },
          { project: projectPoint, includeMidpoints: false, selectedEntityIds: dimensionSelection, preferredCurveId: directEntityId }
        );
    const id = pointHit?.targetPointId ?? curveHit?.entityId;
    if (modification.phase !== 'idle') {
      // The command may remove the clicked endpoint. Keep the browser's later mousedown
      // from assigning focus to that disappearing target instead of the sketch canvas.
      event.preventDefault();
      const hit = pickSketchSnap(
        sketch,
        { x: event.clientX, y: event.clientY },
        { project: projectPoint, pointRadiusPx: -1, includeMidpoints: false }
      );
      const curveId = hit?.entityId;
      if (modification.phase === 'offset') {
        if (!modification.entityIds.length || event.shiftKey) {
          if (!curveId) return setMessage('Select a line, circle or arc to offset.');
          const next = modification.entityIds.includes(curveId)
            ? modification.entityIds.filter(id => id !== curveId)
            : modificationSourceIds(sketch, [...modification.entityIds, curveId], 'offset');
          setModification(previous => transitionModification(previous, { type: 'sources', entityIds: next }));
          setSelected(next);
        } else {
          event.preventDefault();
          acceptOffset();
        }
      } else if (modification.phase === 'mirror') {
        if (modification.picking === 'entities' || event.shiftKey) {
          const pickedId = curveId ?? pointHit?.targetPointId;
          if (!pickedId) return;
          const next = modification.entityIds.includes(pickedId)
            ? modification.entityIds.filter(id => id !== pickedId)
            : modificationSourceIds(sketch, [...modification.entityIds, pickedId], 'mirror');
          setModification(previous => transitionModification(previous, { type: 'sources', entityIds: next }));
          setSelected(next);
          setMessage('Add entities, then press Enter or choose Mirror line.');
        } else if (curveId) {
          const result = mirrorSketchEntities(sketch, { entityIds: modification.entityIds, axisId: curveId });
          if (!result.ok) return setMessage(result.message);
          changeSketch(result.sketch);
          setModification(previous => transitionModification(previous, { type: 'complete' }));
          setSelected([]);
          setHoveredModifyCurve(null);
          setMessage('Mirrored geometry created. Select entities to mirror again.');
        }
      } else if (!modification.entityId) {
        const curve = sketch.entities.find(entity => entity.id === curveId);
        if (!curve || (curve.type !== 'line' && curve.type !== 'arc')) return setMessage('Select near an endpoint of a line or arc.');
        const points = pointsOf(sketch),
          start = points.get(curve.startId)!,
          end = points.get(curve.endId)!;
        const endName = Math.hypot(p.x - start.x, p.y - start.y) <= Math.hypot(p.x - end.x, p.y - end.y) ? 'start' : 'end';
        setModification(previous => transitionModification(previous, { type: 'extendPick', entityId: curve.id, end: endName }));
        setSelected([curve.id]);
        setModifyTarget(null);
        setMessage('Click the new endpoint or a boundary. Escape cancels this extension.');
      } else {
        const result = extendSketchCurve(sketch, {
          entityId: modification.entityId,
          end: modification.end!,
          target: p,
          boundaryId: curveId !== modification.entityId ? curveId : undefined,
        });
        if (!result.ok) return setMessage(result.message);
        changeSketch(result.sketch);
        setModification(previous => transitionModification(previous, { type: 'complete' }));
        setSelected([]);
        setModifyTarget(null);
        setMessage(
          result.kind === 'delete'
            ? 'Curve removed by crossing its opposite endpoint. Undo restores it.'
            : 'Curve extended. Select another endpoint.'
        );
      }
      return;
    }
    if (tool === 'fillet') {
      if (id) {
        setSelected(previous => (previous.includes(id) ? previous.filter(existing => existing !== id) : [...previous, id]));
        setFilletEditing(false);
      }
      return;
    }
    if (tool === 'curveControlPoint') {
      const polygon = pickBezierControlPolygon(sketch, { x: event.clientX, y: event.clientY }, { project: projectPoint, curveRadiusPx: 8 });
      if (polygon?.kind === 'vertex') return setMessage('Choose a segment of the Bezier control polygon, away from its vertices.');
      const hit =
        polygon ??
        pickSketchSnap(
          sketch,
          { x: event.clientX, y: event.clientY },
          { project: projectPoint, pointRadiusPx: -1, curveRadiusPx: 8, includeMidpoints: false }
        );
      const curve = sketch.entities.find(entity => entity.id === hit?.entityId);
      if (!curve || (curve.type !== 'spline' && curve.type !== 'bezier'))
        return setMessage('Choose an open spline or a Bezier control-polygon segment.');
      try {
        changeSketch(insertCurveControlPoint(sketch, curve.id, hit?.parameter ?? 0.5));
        chooseTool('select');
        setSelected([curve.id]);
        setMessage('Control point added. Drag its handle to reshape the curve.');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (tool === 'tangentArc' && !pending.length) {
      const point = pointHit?.targetPointId && sketch.entities.find(entity => entity.id === pointHit.targetPointId);
      if (!point || point.type !== 'point') return setMessage('Choose an existing endpoint of a line or arc.');
      const equivalent = pointEquivalence(sketch.constraints);
      const candidates = sketch.entities.filter(
        entity =>
          (entity.type === 'line' || entity.type === 'arc') &&
          [entity.startId, entity.endId].some(id => equivalent.equivalent(id, point.id))
      );
      const curve = candidates.find(candidate => selected.includes(candidate.id)) ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (!curve) return setMessage('Choose an unambiguous line or arc endpoint, or preselect its curve.');
      if (curve.type !== 'line' && curve.type !== 'arc') return;
      const pointId = equivalent.equivalent(curve.startId, point.id) ? curve.startId : curve.endId;
      setChain({ pointId, curveId: curve.id });
      setPending([{ x: point.x, y: point.y }]);
      pendingSnaps.current = [];
      setLineContinuation(true);
      setMessage('Click the tangent arc end.');
      return;
    }
    if (constraintMode) {
      if (!id) return;
      const next = selected.includes(id) ? selected : [...selected, id];
      const result = buildConstraintForSelection(sketch, constraintMode, next);
      if (result.constraint) {
        changeSketch(addConstraint(sketch, result.constraint));
        setSelected([]);
        setMessage(`${result.message} ${constraintPrompt(constraintMode)}`);
      } else if (result.alreadyApplied) {
        setSelected([]);
        setMessage(result.message);
      } else {
        setSelected(result.needsMore ? next : [id]);
        setMessage(result.message);
      }
      return;
    }
    if (tool === 'point') {
      let next = addPoint(sketch, { ...p, construction });
      next = addSnapRelations(next, [lastDrawingHint.current]);
      changeSketch(next);
      const added = next.entities.find(e => e.type === 'point' && !sketch.entities.some(before => before.id === e.id));
      setSelected(added ? [added.id] : pointHit?.targetPointId ? [pointHit.targetPointId] : []);
      svg.current?.focus();
      return;
    }
    if (tool === 'trim') {
      // Trimming may replace the clicked circle or delete its interval before mousedown.
      event.preventDefault();
      if (id) {
        const entity = sketch.entities.find(entity => entity.id === id);
        if (entity && isOwnedSplineHandle(entity))
          return setMessage('Spline tangent handles cannot be trimmed. Edit their constraints or reshape the spline.');
        const trimmed = trimSketchCurveAt(sketch, id, p);
        if (trimmed) changeSketch(trimmed);
        else setMessage('Trim supports line, circle and arc intervals. Select other curves and press Delete to remove them.');
      }
      return;
    }
    if (tool === 'dimension') {
      if (id) {
        const position = curveHit?.point ?? pointHit?.point ?? p;
        setCursor(position);
        applyDimensionEvent({ type: 'pick', entityId: id, previewId: newCadId(), additive: event.shiftKey, position });
      } else {
        const matrix = svg.current?.getScreenCTM();
        if (!matrix) return;
        const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        // Placement opens the input during pointerdown; suppress the following native mousedown focus.
        event.preventDefault();
        applyDimensionEvent({ type: 'place', position: { x: raw.x, y: -raw.y } });
      }
      return;
    }
    if (tool === 'select') {
      // The canvas owns keyboard focus throughout selection and geometry drags.
      event.preventDefault();
      if (!id) {
        if (tool === 'select') {
          const matrix = svg.current?.getScreenCTM();
          if (matrix) {
            const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
            const start = { x: raw.x, y: -raw.y };
            boxGesture.current = {
              start,
              end: start,
              screenStart: { x: event.clientX, y: event.clientY },
              selected: [...selected],
              additive: event.shiftKey,
              moved: false,
            };
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        }
        if (!event.shiftKey) setSelected([]);
        setDimension(null);
        return;
      }
      const next = event.shiftKey
        ? selected.includes(id)
          ? selected.filter(existing => existing !== id)
          : [...selected, id]
        : selected.includes(id)
          ? selected
          : [id];
      selectionHints.current[id] = { ...(curveHit?.point ?? pointHit?.point ?? p) };
      setSelected(next);
      setDimension(null);
      const entity = sketch.entities.find(e => e.id === id);
      if (entity && !event.shiftKey) {
        const radiusEntityId =
          next.length === 1 &&
          entity.type === 'circle' &&
          !sketch.constraints.some(c => (c.type === 'radius' || c.type === 'diameter') && !c.driven && c.entityId === entity.id)
            ? entity.id
            : undefined;
        const targets = dragTargets(sketch, next, { x: 0, y: 0 });
        if (!radiusEntityId && !targets.length) {
          setMessage('The selected points are fixed. Unfix them or edit the dimensions to move this geometry.');
          return;
        }
        drag.current = {
          origin: p,
          target: p,
          document: doc,
          preview: doc,
          partId: part!.id,
          selectedIds: next,
          points: radiusEntityId && entity.type === 'circle' ? [entity.centerId] : targets.map(t => t.pointId),
          radiusEntityId,
          moved: false,
          request: 0,
          solvedRequest: 0,
          working: false,
          ended: false,
          snapPointId: entity.type === 'point' && next.length === 1 ? entity.id : undefined,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      return;
    }
    if (tool === 'spline' || tool === 'bezier') {
      const last = pending.at(-1);
      if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-7) {
        setPending([...pending, p]);
        pendingSnaps.current.push(lastDrawingHint.current);
      }
    } else if (!pending.length) {
      setPending([p]);
      pendingSnaps.current = [lastDrawingHint.current];
      setLineContinuation(false);
      const gesture = transitionDrawingGesture(drawingGesture.current, {
        type: 'press',
        tool,
        pointerId: event.pointerId,
        position: { x: event.clientX, y: event.clientY },
        canStart: true,
      });
      drawingGesture.current = gesture.state;
      if (gesture.state.phase === 'pressed') {
        setCursor(p);
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      if (tool === 'arc') setMessage('Click the arc end, then move to shape the arc.');
    } else if ((tool === 'arc' || tool === 'conic') && pending.length === 1) {
      setPending([...pending, p]);
      pendingSnaps.current.push(lastDrawingHint.current);
      setMessage(tool === 'arc' ? 'Move to shape the arc, then click a point on it.' : 'Click the conic control point.');
    } else {
      // Rho opens during this pointerdown. Suppress the browser's following mousedown
      // focus so the new input keeps ownership after the complete click sequence.
      if (tool === 'conic') event.preventDefault();
      addShape(p);
    }
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    contextPress.current = transitionSketchContextPress(contextPress.current, {
      type: 'move',
      pointerId: event.pointerId,
      position: { x: event.clientX, y: event.clientY },
    }).state;
    drawingGesture.current = transitionDrawingGesture(drawingGesture.current, {
      type: 'move',
      pointerId: event.pointerId,
      position: { x: event.clientX, y: event.clientY },
    }).state;
    const annotation = annotationDrag.current;
    if (annotation) {
      const matrix = svg.current?.getScreenCTM();
      if (
        !matrix ||
        (!annotation.moved && Math.hypot(event.clientX - annotation.screenStart.x, event.clientY - annotation.screenStart.y) < 3)
      )
        return;
      annotation.moved = true;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const labelPosition = {
        x: annotation.position.x + point.x - annotation.worldStart.x,
        y: annotation.position.y - point.y - annotation.worldStart.y,
      };
      const next = {
        ...annotation.document,
        parts: annotation.document.parts.map(p => ({
          ...p,
          sketch: {
            ...p.sketch,
            constraints: p.sketch.constraints.map(c =>
              c.id === annotation.id && numeric(c) ? withDimensionPlacement(p.sketch, c, labelPosition) : c
            ),
          },
        })),
      };
      documentRef.current = next;
      setDocument(next);
      return;
    }
    const box = boxGesture.current;
    if (box) {
      const matrix = svg.current?.getScreenCTM();
      if (!matrix) return;
      const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      box.end = { x: raw.x, y: -raw.y };
      box.additive ||= event.shiftKey;
      box.moved ||= Math.hypot(event.clientX - box.screenStart.x, event.clientY - box.screenStart.y) >= 3;
      if (box.moved) setSelectionBox({ start: box.start, end: box.end });
      setSnapCue(null);
      setDrawingCue(null);
      setHoveredPoint(null);
      return;
    }
    let p = pointAt(event);
    if (sketch && modification.phase !== 'idle') {
      const hit = pickSketchSnap(
        sketch,
        { x: event.clientX, y: event.clientY },
        { project: projectPoint, pointRadiusPx: -1, includeMidpoints: false }
      );
      setHoveredModifyCurve(hit?.entityId ?? null);
      if (modification.phase === 'extend' && modification.entityId) setModifyTarget(p);
    }
    if (placingDimension) {
      const matrix = svg.current?.getScreenCTM();
      if (matrix) {
        const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        p = { x: raw.x, y: -raw.y };
        if (sketch) setDimensionFlow(transitionDimensionWorkflow(sketch, dimensionFlow, { type: 'hover', position: p }).state);
      }
    }
    const movingPoint = drag.current;
    let drop: CadDrawingInference | null = null;
    if (movingPoint?.snapPointId) {
      const source = movingPoint.document.parts.find(part => part.id === movingPoint.partId)!.sketch;
      const point = source.entities.find(entity => entity.id === movingPoint.snapPointId)!;
      const matrix = svg.current?.getScreenCTM();
      if (point.type === 'point' && matrix) {
        const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        drop = inferDragPoint(
          source,
          point.id,
          { x: point.x + raw.x - movingPoint.origin.x, y: point.y - raw.y - movingPoint.origin.y },
          { project: projectPoint, excludePointIds: movingPoint.points, enabled: snap && !event.shiftKey }
        );
        movingPoint.dropInference = drop;
        p = { x: movingPoint.origin.x + drop.point.x - point.x, y: movingPoint.origin.y + drop.point.y - point.y };
      }
    }
    setCursor(drop?.point ?? p);
    setDrawingCue(movingPoint?.snapPointId ? (snap && !event.shiftKey ? drop : null) : lastDrawingHint.current);
    const pointHit = sketch
      ? pickSketchPoint(
          sketch,
          { x: event.clientX, y: event.clientY },
          { project: projectPoint, excludePointIds: drag.current?.points, selectedEntityIds: dimensionSelection }
        )
      : null;
    setHoveredPoint(pointHit?.targetPointId ?? null);
    setSnapCue(
      snap && !(movingPoint?.snapPointId && event.shiftKey)
        ? drop?.snap
          ? { point: drop.point, label: snapLabels[drop.snap.kind] }
          : inference.current
            ? { point: p, label: inference.current }
            : lastSnap.current
              ? { point: lastSnap.current.point, label: snapLabels[lastSnap.current.kind] }
              : null
        : null
    );
    if (pan.current && (contextPress.current.phase !== 'pressed' || contextPress.current.moved)) {
      const box = svg.current!.getBoundingClientRect();
      const v = pan.current;
      setView({
        ...v.view,
        x: v.view.x - ((event.clientX - v.x) * v.view.w) / box.width,
        y: v.view.y - ((event.clientY - v.y) * v.view.h) / box.height,
      });
    }
    const moving = drag.current;
    if (!moving || moving.ended || moving.failure) return;
    const dx = p.x - moving.origin.x,
      dy = p.y - moving.origin.y;
    if (!moving.moved && Math.hypot(dx, dy) < 0.25) return;
    moving.moved = true;
    moving.target = p;
    moving.request++;
    void solveDrag(moving);
  };
  const pointerEnd = (cancel = false, event?: PointerEvent<SVGSVGElement>) => {
    pan.current = null;
    if (contextPress.current.phase === 'pressed') {
      const context = transitionSketchContextPress(
        contextPress.current,
        cancel || !event
          ? { type: 'cancel' }
          : { type: 'release', pointerId: event.pointerId, position: { x: event.clientX, y: event.clientY } }
      );
      contextPress.current = context.state;
      if (context.open) openContext(context.open.target, context.open.position);
      return;
    }
    if (drawingGesture.current.phase === 'pressed') {
      const gesture = transitionDrawingGesture(
        drawingGesture.current,
        cancel || !event
          ? { type: 'cancel' }
          : { type: 'release', pointerId: event.pointerId, position: { x: event.clientX, y: event.clientY } }
      );
      drawingGesture.current = gesture.state;
      if (gesture.effect === 'cancel') {
        setPending([]);
        pendingSnaps.current = [];
        setLineContinuation(false);
        setDrawingCue(null);
        setSnapCue(null);
      } else if (gesture.effect === 'complete' && event) {
        const end = pointAt(event);
        setCursor(end);
        addShape(end);
      }
      return;
    }
    const box = boxGesture.current;
    if (box) {
      boxGesture.current = null;
      setSelectionBox(null);
      if (cancel) setSelected(box.selected);
      else if (box.moved && sketch) {
        const result = boxSelectSketch(sketch, box, {
          visiblePointIds: visibleSketchPointIds(sketch, selected),
          curveTolerance: 0.25 / markerScale,
        });
        setSelected(box.additive ? [...new Set([...box.selected, ...result.entityIds])] : result.entityIds);
        if (!box.additive) setSelectedConstraints([]);
      }
      return;
    }
    const annotation = annotationDrag.current;
    if (annotation) {
      annotationDrag.current = null;
      if (cancel) {
        documentRef.current = annotation.document;
        setDocument(annotation.document);
      } else if (annotation.moved) commit(documentRef.current);
      if (cancel || !annotation.moved) requestSketchCheck();
      svg.current?.focus();
      return;
    }
    const moving = drag.current;
    if (!moving) return;
    // Pointer capture is lost after a normal release; it must not cancel the finishing solve.
    if (moving.ended) return;
    if (cancel) {
      drag.current = null;
      setDocument(moving.document);
      documentRef.current = moving.document;
      setBusy(false);
      requestSketchCheck();
    } else if (moving.moved) {
      moving.ended = true;
      setBusy(true);
      void solveDrag(moving);
    } else {
      drag.current = null;
      requestSketchCheck();
      restoreCanvasKeyboard();
    }
  };
  const prepareDocument = (): CadDocument | null => {
    const blocked = (reason: string) => {
      setFinishError(reason);
      setMessage(reason);
      callbacks.current.onFinishBlocked?.(reason);
      return null;
    };
    if (busy || solving || finishing.current || preparingDimension.current) return blocked('Wait for the current sketch check to finish.');
    const reason = !thicknessValid
      ? 'Enter a valid part thickness before finishing the sketch.'
      : tool === 'fillet' && selected.length
        ? 'Apply the fillet radius or press Escape before finishing the sketch.'
        : modification.phase === 'mirror' && modification.entityIds.length
          ? 'Choose the mirror line or press Escape before finishing the sketch.'
          : modification.phase === 'extend' && modification.entityId
            ? 'Place the extended endpoint or press Escape before finishing the sketch.'
            : pending.length && !lineContinuation
              ? 'Complete the current shape or press Escape before finishing the sketch.'
              : null;
    if (reason) {
      return blocked(reason);
    }
    try {
      const offsetError = acceptOffset();
      if (offsetError) return blocked(offsetError);
      const dimensionError = applyDimensionValue();
      if (dimensionError) return blocked(dimensionError);
      const rhoError = applyConicRho();
      if (rhoError) return blocked(rhoError);
      if (creationValues?.editing) {
        const creationError = applyCreationValue({ advance: false });
        if (creationError) return blocked(creationError);
      }
    } catch (error) {
      return blocked(error instanceof Error ? error.message : String(error));
    }
    if (lineContinuation) setPending([]);
    return documentRef.current;
  };
  const finish = async (): Promise<boolean> => {
    const prepared = prepareDocument();
    if (!prepared) return false;
    finishing.current = true;
    setFinishError(null);
    setBusy(true);
    try {
      await callbacks.current.onFinish(prepared);
      acceptCadSession(session, prepared);
      return true;
    } catch (error) {
      setFinishError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      finishing.current = false;
      setBusy(false);
      // Acceptance owns normalization while it runs. Resume ordinary draft checks
      // if the editor stays mounted after a blocked acceptance or a host callback.
      requestSketchCheck();
    }
  };
  useImperativeHandle(controller, () => ({ finish, prepareDocument }));
  const cancel = async () => {
    setBusy(true);
    try {
      const restored = { ...structuredClone(session.entry), revision: session.document.revision + 1 };
      session.document = restored;
      session.past = [];
      session.future = [];
      publish(restored);
      await callbacks.current.onCancel();
      endCadSession(doc.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const valuePosition = (anchor: Point | null, desiredWidth = 216, topOffset = 12) => {
    const matrix = svg.current?.getScreenCTM();
    const drawing = svg.current?.closest('.cad-drawing')?.getBoundingClientRect();
    if (!anchor || !matrix || !drawing) return undefined;
    const screen = new DOMPoint(anchor.x, -anchor.y).matrixTransform(matrix);
    const width = Math.min(desiredWidth, Math.max(0, drawing.width - 16));
    return {
      left: Math.max(8, Math.min(screen.x - drawing.left - width / 2, drawing.width - width - 8)),
      top: Math.max(8, Math.min(screen.y - drawing.top + topOffset, drawing.height - 44 - 8)),
      width,
    };
  };
  const dimensionEditorPosition =
    currentDimension && numeric(currentDimension) && sketch
      ? valuePosition(dimensionAnchor(currentDimension, sketch, markerScale))
      : undefined;
  const creationPositions =
    creationValues && sketch
      ? creationValues.steps.map((_, index) =>
          valuePosition(
            creationValueAnchor(creationValues, sketch, index, markerScale),
            creationValues.editing && index === creationValues.index ? 170 : 72,
            -12
          )
        )
      : [];
  const offsetDimension = offsetPreview?.ok
    ? (offsetPreview.sketch.constraints.find(c => c.id === offsetPreview.dimensionId && numeric(c)) as NumericConstraint | undefined)
    : undefined;
  const offsetPosition =
    offsetDimension && offsetPreview?.ok
      ? valuePosition(
          dimensionAnchor(offsetDimension, offsetPreview.sketch, markerScale),
          modification.phase === 'offset' && modification.editing ? 250 : 140,
          -14
        )
      : undefined;
  const canEditCanvasDimensions = !constraintMode && dimensionFlow.phase === 'idle' && (tool === 'select' || tool === 'dimension');
  const activeSketchStatus = sketchStatuses[part?.id ?? ''];
  const displayStatus =
    activeSketchStatus?.status === 'solved' && (inProgress || !problems.length)
      ? sketchDofStatus(activeSketchStatus.dof, !sketch?.entities.some(e => e.type !== 'point' && !e.construction))
      : status;
  const currentSolverResult = !solving && lastCheckedRevision.current === `${doc.id}:${doc.revision}`;
  const colorNotice = currentSolverResult ? constraintColorNotice(activeSketchStatus) : undefined;
  const entityStatus =
    currentSolverResult && !drag.current && !filletPreview?.ok && activeSketchStatus?.status === 'solved'
      ? activeSketchStatus.entityStatus
      : undefined;
  const stroke =
    activeSketchStatus?.status === 'conflict'
      ? '#c73535'
      : currentSolverResult && activeSketchStatus?.status === 'solved' && activeSketchStatus.dof === 0
        ? SKETCH_APPEARANCE.constrainedColor
        : SKETCH_APPEARANCE.freeColor;
  const grid = Math.max(1, 10 ** Math.floor(Math.log10(view.w / 20)));
  const chainPreview = sketch && chainGeometry(sketch, chain);
  const numberOfShapes = sketch?.entities.filter(e => e.type !== 'point' && !e.construction).length ?? 0;
  const acceptanceNotice = notice ?? finishError;
  return (
    <div
      ref={root}
      className="cad-editor"
      aria-busy={busy}
      data-demo-mode={isDemoMode() || undefined}
      onKeyDown={keyDown}
      onKeyUp={event => event.stopPropagation()}>
      <SketchToolbar
        tools={tools}
        tool={tool}
        construction={construction}
        constraintMode={constraintMode}
        busy={busy}
        canUndo={session.past.length > 0}
        canRedo={session.future.length > 0}
        canFinish={thicknessValid && !solving && !problems.length && numberOfShapes > 0 && !(tool === 'fillet' && selected.length)}
        onTool={next => {
          if (next === 'dimension') beginDimension();
          else chooseTool(next);
        }}
        onConstruction={toggleConstruction}
        onConstraint={constrain}
        onFix={toggleFix}
        onUndo={() => navigateHistory()}
        onRedo={() => navigateHistory(true)}
        onCancel={() => void cancel()}
        onFinish={() => void finish()}
        onReturnToCanvas={restoreCanvasKeyboard}
      />
      <div className="cad-workspace" inert={busy}>
        <aside className="cad-sidebar" aria-label="Parts and sketch properties">
          <div className="cad-panel-heading">
            <h2>Parts</h2>
            <button
              type="button"
              aria-label="Add part"
              onClick={() => {
                const added = createCadPart(`Part ${doc.parts.length + 1}`, part?.thickness ?? 18);
                commit({ ...doc, parts: [...doc.parts, added] });
                setPartId(added.id);
                setSelected([]);
                chooseTool('select');
              }}>
              ＋
            </button>
          </div>
          <ul className="cad-part-list">
            {doc.parts.map(p => (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={p.id === part?.id}
                  onClick={() => {
                    setPartId(p.id);
                    setSelected([]);
                    chooseTool('select');
                  }}>
                  <span aria-hidden="true">▱</span>
                  <span>{p.name}</span>
                  <small>{p.thickness} mm</small>
                </button>
              </li>
            ))}
          </ul>
          {part && (
            <div className="cad-properties">
              <h3>{part.name} · Sketch</h3>
              <label htmlFor="cad-part-name">Part name</label>
              <input
                id="cad-part-name"
                key={`${part.id}:${part.name}`}
                defaultValue={part.name}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                    event.preventDefault();
                    event.currentTarget.blur();
                    svg.current?.focus();
                  }
                  if (event.key === 'Escape') {
                    event.currentTarget.value = part.name;
                    event.currentTarget.blur();
                    svg.current?.focus();
                  }
                }}
                onBlur={event => {
                  const name = event.currentTarget.value.trim();
                  if (name && name !== part.name) commit(replacePart(doc, part.id, p => ({ ...p, name })));
                }}
              />
              <CadThicknessField
                key={part.id}
                value={part.thickness}
                onValidityChange={setThicknessValid}
                onDone={() => svg.current?.focus()}
                onCommit={thickness => commit(replacePart(doc, part.id, p => ({ ...p, thickness })))}
              />
              <button
                type="button"
                className="cad-delete-part"
                onClick={() => {
                  const parts = doc.parts.filter(p => p.id !== part.id);
                  commit({ ...doc, parts });
                  setPartId(parts[0]?.id ?? '');
                  setSelected([]);
                  chooseTool('select');
                }}>
                Delete part
              </button>
              <div className="cad-divider" />
              <label className="cad-show-constraints">
                <input
                  type="checkbox"
                  checked={showConstraints}
                  onChange={event => {
                    setShowConstraints(event.target.checked);
                    setHoveredConstraintEntities([]);
                  }}
                />
                Show constraints
              </label>
              {(tool === 'dimension' || placingDimension || dimension !== null) && (
                <>
                  <label className="cad-dimension-mode" htmlFor="cad-dimension-mode">
                    Dimension type
                    <select
                      id="cad-dimension-mode"
                      value={dimensionMode}
                      onChange={event => applyDimensionEvent({ type: 'mode', mode: event.target.value as DimensionMode })}>
                      <option value="auto">Automatic</option>
                      <option value="distance">Length</option>
                      <option value="distanceX">Horizontal distance</option>
                      <option value="distanceY">Vertical distance</option>
                      <option value="angle">Angle</option>
                    </select>
                  </label>
                </>
              )}
              <p className="cad-muted">Select a constraint and press Delete to remove it. Double-click a dimension to edit its value.</p>
              {selected.length === 1 &&
                sketch?.entities.some(entity => entity.id === selected[0] && entity.type === 'conic') &&
                tool === 'select' && (
                  <button
                    type="button"
                    onClick={() => {
                      const curve = sketch.entities.find(entity => entity.id === selected[0]);
                      if (curve?.type === 'conic') {
                        setRho(String(curve.rho));
                        setConicEditing(curve.id);
                      }
                    }}>
                    Edit conic rho
                  </button>
                )}
            </div>
          )}
        </aside>
        <main className="cad-drawing">
          {acceptanceNotice && (
            <p className="cad-notice" role="alert">
              {acceptanceNotice}
            </p>
          )}
          <div className="cad-canvas-bar">
            <span>
              <strong>TOP</strong> · {part?.name ?? 'Sketch'} <span className="cad-muted">/ XY plane</span>
            </span>
            <div>
              <button type="button" onClick={() => fit()}>
                Fit <kbd>F</kbd>
              </button>
              <button
                type="button"
                aria-pressed={snap}
                onClick={() => {
                  setSnap(value => !value);
                  setDrawingCue(null);
                  setSnapCue(null);
                  hoveredReferences.current = [];
                  svg.current?.focus();
                }}>
                Snap {snap ? 'on' : 'off'}
              </button>
            </div>
          </div>
          <svg
            ref={svg}
            className={`cad-canvas cad-tool-${tool}`}
            data-testid="cad-canvas"
            role="img"
            aria-label="2D sketch drawing canvas"
            tabIndex={0}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onDoubleClick={event => {
              if (tool === 'spline' || tool === 'bezier') {
                event.preventDefault();
                finishSpline();
                return;
              }
              if (tool !== 'select' || !sketch) return;
              const id = (event.target as Element).closest('[data-entity-id]')?.getAttribute('data-entity-id');
              const curve = sketch.entities.find(entity => entity.id === id);
              if (curve?.type === 'conic') {
                event.preventDefault();
                setRho(String(curve.rho));
                setConicEditing(curve.id);
              }
            }}
            onPointerLeave={() => {
              if (!drag.current) {
                setHoveredPoint(null);
                setSnapCue(null);
                setDrawingCue(null);
              }
            }}
            onPointerUp={event => pointerEnd(false, event)}
            onPointerCancel={event => pointerEnd(true, event)}
            onLostPointerCapture={event => pointerEnd(true, event)}
            onContextMenu={event => {
              event.preventDefault();
              if (event.button !== 2) keyboardContext();
            }}>
            <defs>
              <pattern id={`cad-grid-${doc.id}`} width={grid} height={grid} patternUnits="userSpaceOnUse">
                <circle cx="0" cy="0" r={grid * 0.025} fill="#ccd5df" />
              </pattern>
            </defs>
            <rect x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} fill={`url(#cad-grid-${doc.id})`} />
            <SketchRegion
              document={doc}
              partId={part?.id}
              verified={
                !solving &&
                !(tool === 'fillet' && selected.length) &&
                activeSketchStatus?.status === 'solved' &&
                lastCheckedRevision.current === `${doc.id}:${doc.revision}`
              }
            />
            <line
              x1={view.x - view.w}
              x2={view.x + view.w * 2}
              y1="0"
              y2="0"
              stroke="#db9d9d"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1="0"
              x2="0"
              y1={view.y - view.h}
              y2={view.y + view.h * 2}
              stroke="#92bfa2"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            {shownSketch && (
              <SketchGeometry
                entities={shownSketch.entities}
                selectedIds={[
                  ...dimensionSelection,
                  ...hoveredConstraintEntities,
                  ...selectedConstraints.flatMap(id => associatedEntityIds(sketch, id)),
                ]}
                stroke={filletPreview?.ok ? '#858d96' : stroke}
                entityStatus={entityStatus}
                pixelScale={markerScale}
                hoveredPointId={hoveredPoint}
                interactive={tool === 'select' && !constraintMode && !placingDimension}
                onEditConic={id => {
                  const curve = sketch?.entities.find(entity => entity.id === id);
                  if (curve?.type === 'conic') {
                    setRho(String(curve.rho));
                    setConicEditing(id);
                  }
                }}
              />
            )}
            {tool === 'fillet' &&
              filletPreview &&
              !filletPreview.ok &&
              filletPreview.cornerPointIds.map(id => {
                const point = sketch?.entities.find(entity => entity.type === 'point' && entity.id === id);
                return point?.type === 'point' ? (
                  <circle
                    key={id}
                    data-fillet-error={id}
                    cx={point.x}
                    cy={-point.y}
                    r={8 / markerScale}
                    fill="#c43b3522"
                    stroke="#c43b35"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                ) : null;
              })}
            {sketch && showConstraints && (
              <InlineConstraints
                sketch={sketch}
                scale={markerScale}
                selectedConstraintIds={selectedConstraints}
                conflictedConstraintIds={conflictedConstraints}
                interactive={tool === 'select' && !constraintMode && !placingDimension}
                onSelect={(id, additive) => {
                  setSelectedConstraints(previous =>
                    additive ? (previous.includes(id) ? previous.filter(existing => existing !== id) : [...previous, id]) : [id]
                  );
                  if (!additive) setSelected([]);
                  setDimension(null);
                  setMessage('Constraint selected. Press Delete to remove it; Undo restores it.');
                  svg.current?.focus();
                }}
                onHover={(_id, ids) => setHoveredConstraintEntities(ids)}
              />
            )}
            {sketch &&
              sketch.constraints
                .filter(numeric)
                .map(c => (
                  <DimensionGraphics
                    key={c.id}
                    constraint={c}
                    sketch={sketch}
                    pixelScale={markerScale}
                    selected={
                      selectedConstraints.includes(c.id) ||
                      (dimensionFlow.phase === 'placing' && dimensionFlow.existingConstraintId === c.id)
                    }
                    conflicted={conflictedConstraints.includes(c.id)}
                    interactive={canEditCanvasDimensions}
                    onSelect={additive => selectDimension(c.id, additive)}
                    onEdit={() => editDimension(c.id)}
                    onLabelPointerDown={event => startAnnotationDrag(c.id, event)}
                  />
                ))}
            {sketch && dimensionDraft && (
              <DimensionGraphics
                constraint={dimensionDraft}
                sketch={sketch}
                pixelScale={markerScale}
                position={dimensionDraft.labelPosition ?? cursor}
                selected
                interactive={false}
              />
            )}
            {snapCue && (
              <g pointerEvents="none">
                <circle
                  cx={snapCue.point.x}
                  cy={-snapCue.point.y}
                  r={5 / markerScale}
                  fill="none"
                  stroke="#bd7b18"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={snapCue.point.x + 9 / markerScale}
                  y={-snapCue.point.y - 8 / markerScale}
                  fontSize={11 / markerScale}
                  fill="#9b6516">
                  {snapCue.label}
                </text>
              </g>
            )}
            {modificationPreview && (
              <ModificationPreview
                sketch={modificationPreview.sketch}
                curveIds={
                  offsetPreview?.ok
                    ? offsetPreview.entityIds
                    : extendPreview?.ok
                      ? [extendPreview.entityId]
                      : mirrorPreview?.ok
                        ? mirrorPreview.createdEntityIds
                        : []
                }
                pixelScale={markerScale}
              />
            )}
            {offsetDimension && offsetPreview?.ok && (
              <DimensionGraphics
                constraint={offsetDimension}
                sketch={offsetPreview.sketch}
                pixelScale={markerScale}
                interactive={false}
                showLabel={false}
              />
            )}
            {modification.phase === 'extend' &&
              modification.entityId &&
              sketch &&
              (() => {
                const curve = sketch.entities.find(e => e.id === modification.entityId);
                const point =
                  curve &&
                  (curve.type === 'line' || curve.type === 'arc') &&
                  pointsOf(sketch).get(modification.end === 'start' ? curve.startId : curve.endId);
                return point ? (
                  <circle
                    data-extend-endpoint={modification.end}
                    cx={point.x}
                    cy={-point.y}
                    r={5 / markerScale}
                    fill="none"
                    stroke={SKETCH_APPEARANCE.selectedColor}
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                ) : null;
              })()}
            {extendPreview?.ok && extendPreview.kind === 'delete' && (
              <text
                data-extend-removes-curve="true"
                x={cursor.x + 10 / markerScale}
                y={-cursor.y - 10 / markerScale}
                fontSize={13 / markerScale}
                fill="#c73535"
                pointerEvents="none">
                Remove curve
              </text>
            )}
            <SketchToolPreview
              tool={tool}
              pending={pending}
              cursor={cursor}
              curvePreview={curvePreview}
              tangent={chainPreview?.tangent}
              pixelScale={markerScale}
              construction={construction}
            />
            {sketch && drawingCue && (
              <DrawingInferencePreview
                inference={drawingCue}
                orientation={inference.current}
                axis={tangentAxis.current}
                start={chainPreview?.point ?? pending[0]}
                sketch={sketch}
                pixelScale={markerScale}
              />
            )}
            {selectionBox && (
              <rect
                data-sketch-selection-box={selectionBox.end.x >= selectionBox.start.x ? 'window' : 'crossing'}
                x={Math.min(selectionBox.start.x, selectionBox.end.x)}
                y={-Math.max(selectionBox.start.y, selectionBox.end.y)}
                width={Math.abs(selectionBox.end.x - selectionBox.start.x)}
                height={Math.abs(selectionBox.end.y - selectionBox.start.y)}
                fill={selectionBox.end.x >= selectionBox.start.x ? '#438bd522' : '#32a76a22'}
                stroke={selectionBox.end.x >= selectionBox.start.x ? '#438bd5' : '#32a76a'}
                strokeWidth="1"
                strokeDasharray={selectionBox.end.x >= selectionBox.start.x ? undefined : '4 3'}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
          </svg>
          <ModificationControls
            state={modification}
            inputRef={offsetInput}
            position={offsetPosition}
            error={offsetPreview && !offsetPreview.ok ? offsetPreview.message : undefined}
            onText={text => setModification(previous => transitionModification(previous, { type: 'text', text }))}
            onEdit={() => setModification(previous => transitionModification(previous, { type: 'edit' }))}
            onAccept={acceptOffset}
            onCancel={() => {
              chooseTool('select');
              setSelected([]);
              svg.current?.focus();
            }}
            onMirrorPicking={picking => {
              setModification(previous => transitionModification(previous, { type: 'mirrorPicking', picking }));
              setMessage(picking === 'axis' ? 'Select the mirror line.' : 'Select entities to mirror; Shift-click adds to selection.');
              svg.current?.focus();
            }}
          />
          {creationValues && creationValues.partId === part?.id && sketch && (
            <CreationValueControls
              inputRef={creationInput}
              state={creationValues}
              sketch={sketch}
              positions={creationPositions}
              onChange={text => setCreationValues({ ...creationValues, text })}
              onStart={index => {
                const value = creationValueAt(creationValues, sketch, index);
                if (value)
                  setCreationValues({ ...creationValues, index, editing: true, text: String(value.constraint.value), selectAll: true });
              }}
              onAccept={applyCreationValue}
              onCancel={() => {
                setCreationValues(null);
                svg.current?.focus();
              }}
            />
          )}
          {palette && (
            <div className="cad-command-palette">
              <h3>Sketch tools</h3>
              {tools.map(t => (
                <button type="button" key={t.id} onClick={() => chooseTool(t.id)}>
                  <SketchToolGlyph kind={t.id} /> {t.label}
                  <kbd>{t.key}</kbd>
                </button>
              ))}
            </div>
          )}
          {tool === 'fillet' && selected.length > 0 && (
            <form
              className="cad-create-size cad-fillet-editor"
              onSubmit={event => {
                event.preventDefault();
                acceptFillet();
              }}>
              <label>
                Fillet radius{' '}
                <CadValueInput
                  inputRef={filletInput}
                  aria-label="Fillet radius"
                  inputMode="decimal"
                  value={filletRadius}
                  onFocus={() => setFilletEditing(true)}
                  onChange={event => setFilletRadius(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      chooseTool('select');
                      setSelected([]);
                    }
                  }}
                />
              </label>
              <button type="submit" disabled={!filletPreview?.ok}>
                Apply fillets
              </button>
              <button
                type="button"
                onClick={() => {
                  chooseTool('select');
                  setSelected([]);
                }}>
                Cancel fillets
              </button>
              {filletPreview && !filletPreview.ok && (
                <span role="alert" className="cad-error">
                  {filletPreview.message}
                </span>
              )}
            </form>
          )}
          {conicEditing && (
            <form
              className="cad-create-size cad-conic-editor"
              onSubmit={event => {
                event.preventDefault();
                applyConicRho();
              }}>
              <label>
                Rho{' '}
                <input
                  ref={rhoInput}
                  aria-label="Conic rho"
                  inputMode="decimal"
                  value={rho}
                  onChange={event => setRho(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      chooseTool('select');
                    }
                  }}
                />
              </label>
              <span>0 &lt; ρ &lt; 1</span>
              <button type="submit">Apply rho</button>
              <button type="button" onClick={() => chooseTool('select')}>
                Close rho
              </button>
            </form>
          )}
          {currentDimension && numeric(currentDimension) && (
            <form
              className="cad-dimension-editor"
              style={dimensionEditorPosition}
              onSubmit={event => {
                event.preventDefault();
                applyDimensionValue();
              }}>
              <label htmlFor="cad-edit-dimension" className="sr-only">
                {currentDimension.label ?? currentDimension.type} <span>{currentDimension.type === 'angle' ? 'degrees' : 'mm'}</span>
              </label>
              <div>
                <CadValueInput
                  id="cad-edit-dimension"
                  inputRef={dimensionInput}
                  key={currentDimension.id}
                  defaultValue={currentDimension.expression ?? String(currentDimension.value)}
                  inputMode="decimal"
                  unit={currentDimension.type === 'angle' ? 'deg' : 'mm'}
                  unitClassName="cad-dimension-unit"
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      cancelDimensionEdit();
                    } else if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229))
                      event.preventDefault();
                  }}
                />
                <button type="submit" aria-label="Apply dimension">
                  ✓
                </button>
                <button type="button" aria-label="Cancel dimension edit" onClick={cancelDimensionEdit}>
                  ×
                </button>
              </div>
            </form>
          )}
          {pending[0] && (tool === 'rectangle' || tool === 'centerRectangle' || tool === 'circle') && (
            <form
              className="cad-create-size"
              onSubmit={event => {
                event.preventDefault();
                addShape();
              }}>
              <span>
                From {rounded(pending[0].x)}, {rounded(pending[0].y)}
              </span>
              {tool === 'rectangle' || tool === 'centerRectangle' ? (
                <>
                  <label>
                    Width{' '}
                    <CadValueInput
                      aria-label="Rectangle width"
                      value={width}
                      onChange={event => setWidth(event.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                  <label>
                    Height{' '}
                    <CadValueInput
                      aria-label="Rectangle height"
                      value={height}
                      onChange={event => setHeight(event.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                </>
              ) : (
                <label>
                  Radius{' '}
                  <CadValueInput
                    aria-label="Circle radius"
                    value={radius}
                    onChange={event => setRadius(event.target.value)}
                    inputMode="decimal"
                  />
                </label>
              )}
              <button type="submit">Create</button>
            </form>
          )}
          <div className="cad-canvas-footer">
            <span>
              {rounded(cursor.x)}, {rounded(cursor.y)} mm
            </span>
            <span>Scroll to zoom · right-drag to pan</span>
            {sketch && (
              <SelectionReadout
                sketch={sketch}
                selectedIds={dimensionSelection}
                picks={dimensionFlow.phase === 'idle' ? selectionHints.current : dimensionFlow.pickHints}
              />
            )}
          </div>
        </main>
      </div>
      {sketch && (
        <SketchContextMenu
          sketch={sketch}
          context={contextMenu}
          busy={busy || solving}
          onClose={() => setContextMenu(null)}
          onAction={contextAction}
          onReturnToCanvas={() => svg.current?.focus()}
        />
      )}
      <footer className="cad-status">
        <span className={problems.length && !inProgress ? 'cad-error' : ''}>
          {solving ? 'Checking sketch…' : displayStatus}
          {colorNotice && ` · ${colorNotice}`}
        </span>
        <span className="cad-instruction" role="status">
          {acceptanceNotice ? '' : message}
        </span>
        <span>{saveStatus ?? 'Draft'}</span>
      </footer>
      {problems.length > 0 && !acceptanceNotice && (
        <div className={`cad-problems${inProgress ? ' cad-sketch-progress' : ''}`} role={inProgress ? undefined : 'alert'}>
          <strong>{inProgress ? 'Sketch in progress' : 'Finish is blocked'}</strong>
          {inProgress ? (
            <p>Keep drawing to close the outline. Your sketch is saved as a draft.</p>
          ) : (
            <ul>
              {problems.map((problem, i) => (
                <li key={i}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
