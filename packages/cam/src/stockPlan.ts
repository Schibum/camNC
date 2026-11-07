import { minOf, type PathsD, type Vec3 } from './geom';
import { StockModel, type CuttingTransitionCertificate, type LinkCertificate } from './stock';
import type { PartCam, Pass } from './toolpaths';
import type { MotionRole } from './motion';
import { parsedPostNumber } from './postValidation';

export interface StockPlanOptions {
  footprint?: PathsD;
  tolerance?: number;
  pathTolerance?: number;
  verticalTolerance?: number;
  plungeFeed: number;
}

export interface StockPlanResult {
  cam: PartCam;
  retractedLinks: number;
  certificates: { operation: number; pass: number; certificate: LinkCertificate }[];
  cuttingCertificates: { operation: number; pass: number; certificate: CuttingTransitionCertificate }[];
}

const samePose = (a: Vec3, b: Vec3) => a.every((value, axis) => value === b[axis]);

/** Remove only the marked generated hop, so a split/reordered program can safely enter at its destination instead. */
function withoutCuttingPrefix(pass: Pass): Pass {
  const transition = pass.cuttingTransition;
  if (!transition) return pass;
  const { from, to } = transition;
  if ([from, to].some(point => point.length !== 3 || point.some(value => !Number.isFinite(value))))
    throw new Error('Cutting transition markers require finite XYZ endpoints');
  if (samePose(pass.pts[0], to)) return pass;
  if (!samePose(pass.pts[0], from)) throw new Error('Cutting transition prefix does not start at its marked pose');
  const dx = to[0] - from[0],
    dy = to[1] - from[1],
    square = dx * dx + dy * dy;
  if (!square || from[2] !== to[2]) throw new Error('Cutting transition prefix must be a nonzero level segment');
  let previous = 0;
  for (let i = 1; i < pass.pts.length; i++) {
    const point = pass.pts[i];
    if (samePose(point, to)) {
      const feeds = pass.feeds.slice(i);
      feeds[0] = minOf(pass.feeds.slice(1, i + 1));
      return { ...pass, pts: pass.pts.slice(i), feeds, ...(pass.roles ? { roles: pass.roles.slice(i) } : {}) };
    }
    const t = ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / square;
    if (point[2] !== from[2] || t < previous || t > 1 || Math.hypot(point[0] - from[0] - t * dx, point[1] - from[1] - t * dy) > 1e-9)
      throw new Error('Cutting transition prefix differs from its marked segment');
    previous = t;
  }
  throw new Error('Cutting transition prefix does not reach its marked destination');
}

function representedFeedAtMost(target: number): number {
  let feed = Math.floor(target * 1000) / 1000;
  if (parsedPostNumber(feed) > target) feed = Math.floor(Math.max(0, target - 0.001 - target * 2 ** -20) * 1000) / 1000;
  return feed;
}

/** Validate candidate stay-down links against removal history in the actual operation order. */
export function certifyStockLinks(cam: PartCam, options: StockPlanOptions, history?: StockModel): StockPlanResult {
  if (!Number.isFinite(options.plungeFeed) || options.plungeFeed <= 0)
    throw new Error('Stock link fallback requires a positive plunge feed');
  const stock = history ?? new StockModel({ stockTop: cam.stockTop, ...options });
  if (stock.stockTop !== cam.stockTop) throw new Error('Shared stock history must use the same stock top');
  const certificates: StockPlanResult['certificates'] = [];
  const cuttingCertificates: StockPlanResult['cuttingCertificates'] = [];
  let retractedLinks = 0;
  const checkpoint = stock.checkpoint();
  try {
    const operations = cam.operations.map((operation, oi) => {
      const radius = operation.tool.diameter / 2;
      let last: Vec3 | undefined;
      // These closures own copied geometry and live only for this operation's traversal.
      // A later post or reorder prepares fresh evidence from the caller's current policy.
      const cuttingCertifiers = new Map<'rough' | 'finish', ReturnType<StockModel['prepareCuttingTransition']>>();
      const plungeFeed = operation.plungeFeed ?? operation.tool.plungeFeed ?? options.plungeFeed;
      if (!Number.isFinite(plungeFeed) || plungeFeed <= 0) throw new Error('Stock link fallback requires a positive operation plunge feed');
      const passes = operation.passes.map((input, pi): Pass => {
        if (!input.pts.length) throw new Error('Stock links require nonempty passes');
        const source = withoutCuttingPrefix(input);
        const first = source.pts[0];
        let pass = { ...source, clearLink: false };
        let cutting = false;
        if (source.cuttingTransition && operation.kind === 'pocket' && operation.pocketTransition && last && source.link === 'direct') {
          const marker = source.cuttingTransition;
          if (samePose(last, marker.from) && samePose(first, marker.to)) {
            const phase = source.phase === 'finish' ? 'finish' : 'rough';
            let certify = cuttingCertifiers.get(phase);
            if (!certify) {
              certify = stock.prepareCuttingTransition({
                ...operation.pocketTransition,
                wallAllowance: phase === 'finish' ? 0 : operation.pocketTransition.wallAllowance,
              });
              cuttingCertifiers.set(phase, certify);
            }
            const certificate = certify(last, first, radius);
            cuttingCertificates.push({ operation: oi, pass: pi, certificate });
            const feed = Math.min(representedFeedAtMost(certificate.feed), source.feeds[0]);
            if (certificate.allowed && feed > 0) {
              const roles: MotionRole[] = source.roles ? [...source.roles] : source.pts.map(() => 'cut');
              roles[0] = 'link';
              pass = {
                ...source,
                pts: [[...last], ...source.pts],
                feeds: [feed, feed, ...source.feeds.slice(1)],
                roles: ['link', ...roles],
                clearLink: true,
              };
              cutting = true;
            }
          }
        }
        if (cutting) {
          // The engaging bridge is an explicit feed segment, with a policy retained for the final post recheck.
        } else if (last && source.link === 'direct' && samePose(last, first)) {
          // The previous actual pose is unchanged; there is no link motion to certify.
          pass = { ...source, clearLink: true };
        } else if (last && source.link === 'direct') {
          const certificate = stock.certifyLink(last, first, radius);
          certificates.push({ operation: oi, pass: pi, certificate });
          if (certificate.clear) pass = { ...source, clearLink: true };
          else {
            retractedLinks++;
            const feeds = [...source.feeds];
            feeds[0] = Math.min(feeds[0], plungeFeed);
            const roles = (source as Pass & { roles?: MotionRole[] }).roles;
            pass = {
              ...source,
              link: 'retract',
              clearLink: false,
              feeds,
              ...(roles ? { roles: ['approach' as const, ...roles.slice(1)] } : {}),
            };
          }
        }
        if (source.cuttingTransition && (pi === 0 || source.link !== 'direct')) {
          pass = { ...pass, link: 'retract', clearLink: false };
          pass.feeds = [...pass.feeds];
          pass.feeds[0] = Math.min(pass.feeds[0], plungeFeed);
          if (pass.roles) pass.roles = ['approach', ...pass.roles.slice(1)];
        }
        // The post retracts before an operation and before passes explicitly marked retract.
        const approach = pass.pts[0];
        if (pi === 0 || pass.link === 'retract')
          stock.recordPath([[approach[0], approach[1], Math.max(cam.stockTop, approach[2])], approach], radius);
        else if (last && !samePose(last, approach)) stock.recordPath([last, approach], radius);
        stock.recordPath(pass.pts, radius);
        last = pass.pts[pass.pts.length - 1];
        return pass;
      });
      return { ...operation, passes };
    });
    return { cam: { ...cam, operations }, certificates, cuttingCertificates, retractedLinks };
  } catch (error) {
    stock.rollback(checkpoint);
    throw error;
  }
}
