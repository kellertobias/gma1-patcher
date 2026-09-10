'use client';

import { useMemo, useState } from 'react';
import { type ShowFiles, download, downloadShow, saveTemplate } from '@/lib/browser';
import { BuildError, type ShowDoc, buildShow, docFromShow, isDirty } from '@/lib/gma1/doc';
import { buildMvr } from '@/lib/mvr/exportMvr';
import { findProblems } from '@/lib/gma1/rules';
import { loadShow } from '@/lib/gma1/show';
import { AddFixtures } from './AddFixtures';
import { GdtfPanel } from './GdtfPanel';
import { LoadPanel } from './LoadPanel';
import { MvrImport } from './MvrImport';
import { PatchTable } from './PatchTable';
import { Button, Section } from './ui';

export default function App() {
  const [doc, setDoc] = useState<ShowDoc | null>(null);
  const [source, setSource] = useState<ShowFiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asZip, setAsZip] = useState(false);

  const problems = useMemo(() => (doc ? findProblems(doc) : []), [doc]);
  const blocking = useMemo(() => (doc ? problems.filter((p) => !doc.baseline.has(p.message)) : []), [doc, problems]);

  function open(files: ShowFiles, fromTemplate: boolean) {
    setError(null);
    setNotice(null);
    try {
      setDoc(docFromShow(loadShow(files.baseName, files.sho, files.tgz)));
      setSource(files);
      if (fromTemplate) setNotice(`Started from the blank template “${files.baseName}”. Export keeps that file name.`);
    } catch (e) {
      setError(`Could not read the show: ${(e as Error).message}`);
    }
  }

  function close() {
    if (doc && isDirty(doc) && !confirm('Discard the changes to this show?')) return;
    setDoc(null);
    setSource(null);
    setNotice(null);
  }

  function generate() {
    if (!doc) return;
    setError(null);
    try {
      const out = buildShow(doc);
      downloadShow({ baseName: out.baseName, sho: out.sho, tgz: out.tgz }, asZip);
      setNotice(`Generated “${out.baseName}”: ${out.fixtures} fixtures, ${out.channels} channels. ` +
        'Copy both files into the show folder of the console or onPC and load the show there to check the patch.');
    } catch (e) {
      setError(e instanceof BuildError ? `${e.message}: see the red rows below.` : `Could not write the show: ${(e as Error).message}`);
    }
  }

  function exportMvr() {
    if (!doc) return;
    setError(null);
    try {
      const { bytes, report } = buildMvr(doc);
      download(`${doc.show.baseName}.mvr`, bytes);
      setNotice(`Exported ${report.fixtures} fixtures (${report.types} GDTF types) to ${doc.show.baseName}.mvr.` +
        (report.skipped.length ? ` Skipped ${report.skipped.length} (unpatched or no channels).` : ''));
    } catch (e) {
      setError(`Could not export MVR: ${(e as Error).message}`);
    }
  }

  const header = doc?.show.header;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-base font-semibold">grandMA1 Patcher</h1>
            <p className="text-xs text-zinc-500">Edit the patch of grandMA1 (v6.x) show files · runs entirely in your browser</p>
          </div>
          {doc && header && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                <strong className="text-zinc-900 dark:text-zinc-100">{header.title}</strong> · file version {header.version}
              </span>
              <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <input type="checkbox" checked={asZip} onChange={(e) => setAsZip(e.target.checked)} /> as ZIP
              </label>
              <Button variant="primary" onClick={generate} disabled={blocking.length > 0}>
                Generate show file
              </Button>
              <Button onClick={exportMvr}>Export MVR</Button>
              <Button variant="quiet" onClick={close}>Close</Button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-4">
        {error && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
        {notice && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{notice}</div>}

        {!doc && <LoadPanel onOpen={open} />}

        {doc && (
          <>
            <Section
              title="Show"
              actions={source && (
                <Button variant="quiet" onClick={() => saveTemplate(source).then(() => setNotice('Stored as blank template in this browser.'))}>
                  Remember as blank template
                </Button>
              )}
            >
              <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                <span>{doc.fixtures.length} fixtures</span>
                <span>{doc.show.types.length} fixture types</span>
                <span>{doc.fixtures.filter((f) => !f.node).length} new</span>
                <span className={blocking.length ? 'font-semibold text-red-600' : 'text-green-700 dark:text-green-400'}>
                  {blocking.length ? `${blocking.length} problem(s) to fix` : 'patch valid'}
                </span>
                {problems.length > blocking.length && (
                  <span className="text-yellow-700 dark:text-yellow-400">{problems.length - blocking.length} warning(s) from the loaded show</span>
                )}
              </div>
            </Section>
            <GdtfPanel doc={doc} onChange={setDoc} />
            <MvrImport doc={doc} onChange={setDoc} />
            <AddFixtures doc={doc} onChange={setDoc} />
            <PatchTable doc={doc} problems={problems} onChange={setDoc} />
          </>
        )}

        <footer className="pb-6 pt-2 text-xs text-zinc-500">
          Not affiliated with MA Lighting. The file format was reverse engineered for interoperability; always check a
          generated show on onPC or the console before using it in a production.
        </footer>
      </main>
    </div>
  );
}
