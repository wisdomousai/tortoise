import type { CatalogRequirements, FolderRequirement } from '@tortoise/contracts';
import type { Findings } from './findings';
import type { SitePolicy } from './schema';

export type DeclaredFolder = FolderRequirement & { readonly owner: string };

/** A declared folder with the directory this site binds it to. */
export interface ResolvedFolder {
  readonly folder: DeclaredFolder;
  readonly path: string;
}

/** A POSIX absolute path or a Windows drive or UNC path. */
const absolute = (path: string) =>
  path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');

/**
 * Resolve the policy's folder bindings against the declared folders. Problems are findings: a
 * binding for an undeclared folder, a relative path, a path two folders share (a reader would
 * see the other's files) and a `required` folder left unbound.
 */
export function resolveFolders(
  policy: SitePolicy,
  requirements: CatalogRequirements,
  report: Findings,
) {
  const declared = new Map(requirements.folders.map((item) => [item.id, item]));
  const folders = new Map<string, ResolvedFolder>();
  const disabled = new Set<string>();
  const byPath = new Map<string, string>();
  for (const [id, binding] of Object.entries(policy.folders ?? {})) {
    const folder = declared.get(id);
    if (!folder) {
      report.error('UNDECLARED_FOLDER', `No module or host component declares folder ${id}`, id);
      continue;
    }
    if ('disabled' in binding) {
      disabled.add(id);
      continue;
    }
    if (!absolute(binding.path)) {
      report.error('FOLDER_PATH', `Folder ${id} must name an absolute path`, id);
      continue;
    }
    const path = binding.path.replace(/[\\/]+$/, '');
    const other = byPath.get(path);
    if (other) {
      report.error('FOLDER_SHARED', `Folders ${other} and ${id} are bound to one directory`, id);
      continue;
    }
    byPath.set(path, id);
    folders.set(id, { folder, path });
  }
  for (const folder of declared.values())
    if (folder.availability === 'required' && !folders.has(folder.id) && !disabled.has(folder.id))
      report.error(
        'REQUIRED_FOLDER_UNBOUND',
        `Required folder ${folder.id} (${folder.owner}) is not bound by the site policy`,
        folder.id,
      );
  return { folders, disabledFolders: disabled };
}
