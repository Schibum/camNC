import type { PathsD, Vec3 } from './geom';
import { StockModel, type LinkCertificate } from './stock';
import type { PartCam, Pass } from './toolpaths';
import type { MotionRole } from './motion';

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
}

/** Validate candidate stay-down links against removal history in the actual operation order. */
export function certifyStockLinks(cam: PartCam, options: StockPlanOptions, history?: StockModel): StockPlanResult {
  if (!Number.isFinite(options.plungeFeed) || options.plungeFeed <= 0)
    throw new Error('Stock link fallback requires a positive plunge feed');
  const stock = history ?? new StockModel({ stockTop: cam.stockTop, ...options });
  if (stock.stockTop !== cam.stockTop) throw new Error('Shared stock history must use the same stock top');
  const certificates: StockPlanResult['certificates'] = [];
  let retractedLinks = 0;
  const operations = cam.operations.map((operation, oi) => {
    const radius = operation.tool.diameter / 2;
    let last: Vec3 | undefined;
    const passes = operation.passes.map((source, pi): Pass => {
      if (!source.pts.length) throw new Error('Stock links require nonempty passes');
      const first = source.pts[0];
      let pass = { ...source, clearLink: false };
      if (last && source.link === 'direct' && last.every((value, axis) => value === first[axis])) {
        // The previous actual pose is unchanged; there is no link motion to certify.
        pass = { ...source, clearLink: true };
      } else if (last && source.link === 'direct') {
        const certificate = stock.certifyLink(last, first, radius);
        certificates.push({ operation: oi, pass: pi, certificate });
        if (certificate.clear) pass = { ...source, clearLink: true };
        else {
          retractedLinks++;
          const feeds = [...source.feeds];
          feeds[0] = Math.min(feeds[0], operation.tool.plungeFeed ?? options.plungeFeed);
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
      // The post retracts before an operation and before passes explicitly marked retract.
      if (pi === 0 || pass.link === 'retract') stock.recordPath([[first[0], first[1], Math.max(cam.stockTop, first[2])], first], radius);
      else if (last) stock.recordPath([last, first], radius);
      stock.recordPath(pass.pts, radius);
      last = pass.pts[pass.pts.length - 1];
      return pass;
    });
    return { ...operation, passes };
  });
  return { cam: { ...cam, operations }, certificates, retractedLinks };
}
