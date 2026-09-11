import type { ShowFiles } from '../../browser';
import { basePath } from '../../basePath';

/**
 * Load the bundled empty gma1 show (the only bundled binary show artifact): an empty show saved on a
 * grandMA1 console (v6.801), with every user profile except DEFAULT removed. The console writes its
 * empty pools at full size (e.g. 999 empty preset slots), which cannot be synthesized reliably — an
 * app-generated empty show crashed the console, so this file must come from a real console save.
 */
export async function loadBlankShow(baseName = 'show'): Promise<ShowFiles> {
  const dir = `${basePath}/blank/blank`;
  const [sho, tgz] = await Promise.all([
    fetch(`${dir}.sho`).then((r) => r.arrayBuffer()),
    fetch(`${dir}.tar.gz`).then((r) => r.arrayBuffer()),
  ]);
  return { baseName, sho: new Uint8Array(sho), tgz: new Uint8Array(tgz) };
}
