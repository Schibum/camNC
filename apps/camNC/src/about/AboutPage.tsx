import { PageHeader } from '@/components/page-header';
import { applicationDistribution, dependencyLicenses, solverDistribution } from './licenses';

function FullText({ name, text }: { name: string; text: string }) {
  return (
    <details className="mt-3 rounded-md border">
      <summary className="cursor-pointer rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2">
        Read {name}
      </summary>
      <div
        role="region"
        aria-label={name}
        tabIndex={0}
        className="max-h-80 overflow-auto border-t bg-muted/40 p-3 focus-visible:outline-2 focus-visible:outline-offset-2">
        <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed">{text}</pre>
      </div>
    </details>
  );
}

const linkClass = 'text-sm underline underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2';

export function AboutPage() {
  return (
    <div className="flex h-dvh min-w-0 flex-1 flex-col">
      <PageHeader title="About" />
      <main aria-labelledby="about-title" className="min-h-0 flex-1 overflow-y-auto px-4 py-6 pb-28 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-8">
          <section aria-labelledby="about-title">
            <h1 id="about-title" className="text-2xl font-semibold">
              About camNC
            </h1>
            <p className="mt-2 text-muted-foreground">Design flat parts, prepare their cuts, and machine them in one workspace.</p>
            <p className="mt-3 text-sm">
              camNC is open source under the Apache License 2.0. Its CAD solver and other components retain their own licenses.
            </p>
            <p className="mt-3">
              <a className={linkClass} href={applicationDistribution.licenseUrl} download>
                Download camNC Apache 2.0 license
              </a>
            </p>
            <FullText name="camNC Apache 2.0 license" text={applicationDistribution.text} />
          </section>

          <section aria-labelledby="solver-notices-title">
            <h2 id="solver-notices-title" className="text-xl font-semibold">
              CAD solver notices and source
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The full notices, license texts and pinned library source are included with this application.
            </p>
            <ul className="mt-3 space-y-2">
              <li>
                <a className={linkClass} href={solverDistribution.noticeUrl} download>
                  Download third-party notices
                </a>
              </li>
              <li>
                <a className={linkClass} href={solverDistribution.sourceUrl} download>
                  Download PlaneGCS source archive
                </a>
              </li>
              <li>
                <a className={linkClass} href={solverDistribution.manifestUrl}>
                  View source provenance and checksums
                </a>
              </li>
              <li>
                <a className={linkClass} href={solverDistribution.upstreamSource} target="_blank" rel="noreferrer">
                  Upstream source and rebuild instructions
                </a>
              </li>
            </ul>
            <FullText name="third-party notices" text={solverDistribution.notice} />
          </section>

          <section aria-labelledby="dependency-licenses-title">
            <h2 id="dependency-licenses-title" className="text-xl font-semibold">
              Solver component licenses
            </h2>
            <div className="mt-4 space-y-4">
              {dependencyLicenses.map(dependency => (
                <section key={dependency.id} aria-labelledby={`license-${dependency.id}`} className="rounded-lg border p-4">
                  <h3 id={`license-${dependency.id}`} className="font-semibold">
                    {dependency.name}
                  </h3>
                  <p className="mt-1 text-sm font-medium">{dependency.license}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{dependency.description}</p>
                  <p className="mt-3">
                    <a className={linkClass} href={dependency.url} download>
                      Download {dependency.name} license
                    </a>
                  </p>
                  <FullText name={`${dependency.name} license`} text={dependency.text} />
                </section>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
