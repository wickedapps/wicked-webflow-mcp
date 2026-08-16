// Which directory the app is managing.
//
// Everything per-project in the CLI — `status`'s activation block, what
// `switch` writes into ~/.claude.json — is keyed on a working directory. In a
// terminal that is wherever you happen to have cd'd. A GUI has no equivalent,
// and an app launched from Finder starts at `/`, so the directory has to be an
// explicit, visible, persistent choice.

import { open } from '@tauri-apps/plugin-dialog'

const KEY = 'wwm.projects.v1'
const MAX_RECENTS = 8

/**
 * Current project and history in one record.
 *
 * One key rather than two, written whole, so the two can never disagree about
 * whether the open folder is in the list.
 */
export interface Projects {
  current: string | null
  recents: string[]
}

const EMPTY: Projects = { current: null, recents: [] }

export function load(): Projects {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY
    const { current, recents } = parsed as Partial<Projects>
    return {
      current: typeof current === 'string' ? current : null,
      recents: Array.isArray(recents) ? recents.filter((r) => typeof r === 'string') : [],
    }
  } catch {
    // A corrupt or unavailable store is not worth failing to launch over.
    return EMPTY
  }
}

function save(next: Projects): Projects {
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* private mode, quota — the session still works, it just will not persist */
  }
  return next
}

/** Make `dir` current and move it to the front of the history. */
export function select(dir: string): Projects {
  const { recents } = load()
  return save({
    current: dir,
    recents: [dir, ...recents.filter((r) => r !== dir)].slice(0, MAX_RECENTS),
  })
}

/**
 * Drop `dir` from the history — for a folder that has been moved or deleted,
 * which is the one thing a persisted list of paths guarantees will happen.
 */
export function forget(dir: string): Projects {
  const { current, recents } = load()
  return save({
    current: current === dir ? null : current,
    recents: recents.filter((r) => r !== dir),
  })
}

/** The native folder picker. Resolves to null if the user cancels. */
export async function pick(startAt: string | null): Promise<string | null> {
  const chosen = await open({
    directory: true,
    multiple: false,
    title: 'Choose a project folder',
    // Spread rather than `?? undefined`: under exactOptionalPropertyTypes an
    // explicit undefined is not the same as an absent key.
    ...(startAt ? { defaultPath: startAt } : {}),
  })
  return typeof chosen === 'string' ? chosen : null
}

/** `/Users/x/work/dino` → `~/work/dino`. Long paths in a header are unreadable otherwise. */
export function abbreviate(dir: string, home: string | null): string {
  if (!home) return dir
  if (dir === home) return '~'
  return dir.startsWith(home + '/') ? '~' + dir.slice(home.length) : dir
}

/** The trailing segment, for when only the folder name fits. */
export const basename = (dir: string): string => dir.split('/').filter(Boolean).pop() ?? dir
