import path from 'node:path';
import { normalizeExecuteCommandInput } from '../tools/shell';
import type { SessionApprovalContext } from './sessionApproval';

const GIT_FLAGS: Record<string, RegExp> = {
  status: /^(?:--short|-s|--branch|-b|--porcelain(?:=v?[12])?|--untracked-files(?:=(?:no|normal|all))?|--ignored(?:=(?:traditional|matching|no))?|--no-renames|-z|--column|--no-column|--show-stash|--ahead-behind|--no-ahead-behind)$/,
  'ls-files': /^(?:--cached|-c|--deleted|-d|--modified|-m|--others|-o|--ignored|-i|--stage|-s|--unmerged|-u|--killed|-k|--exclude-standard|--full-name|-z)$/,
  log: /^(?:--oneline|--all|--no-decorate|--decorate(?:=(?:short|full|auto|no))?|--graph|--date-order|--reverse|--no-merges|--merges|--first-parent|--max-count=\d+|-\d+|--since=[^\r\n]+|--until=[^\r\n]+|--author=[^\r\n]+|--grep=[^\r\n]+)$/,
  diff: /^(?:--no-ext-diff|--no-textconv|--stat|--shortstat|--numstat|--name-only|--name-status|--check|--cached|--staged|--no-color|--color=never|--no-renames|--ignore-space-at-eol|--ignore-all-space|-w|--unified=\d+)$/
};

/** Recognize bounded actions, never an executable-wide or arbitrary prefix grant. */
export function sessionCommandAction(args: Record<string, unknown>, context: SessionApprovalContext): string | undefined {
  try {
    const input = normalizeExecuteCommandInput(args);
    const root = context.workspaceRoot && context.directoryForPath(context.workspaceRoot, 'read');
    if (!root) return undefined;
    // Bare names only: /tmp/node must not inherit permission for the configured node binary.
    const infoFlags = input.command === 'node' ? ['--version', '-v', '--help', '-h']
      : ['python', 'python3'].includes(input.command) ? ['--version', '-V', '--help', '-h'] : [];
    if (input.args.length === 1 && infoFlags.includes(input.args[0])) {
      return JSON.stringify([input.command, 'information', root]);
    }
    if (input.command !== 'git') return undefined;
    const [action, ...options] = input.args;
    const flags = GIT_FLAGS[action];
    if (!flags) return undefined;
    // Diff drivers can run programs; only explicitly disabled drivers qualify for reuse.
    if (action === 'diff' && (!options.includes('--no-ext-diff') || !options.includes('--no-textconv'))) return undefined;
    let pathsOnly = false;
    for (const option of options) {
      if (!pathsOnly && option === '--') { pathsOnly = true; continue; }
      if (!pathsOnly && option.startsWith('-')) {
        if (!flags.test(option)) return undefined;
        continue;
      }
      // Revisions in log/diff are deliberately excluded unless separated as file paths.
      if (!pathsOnly && (action === 'log' || action === 'diff')) return undefined;
      if (context.directoryForPath(path.resolve(root, option), 'read') !== root) return undefined;
    }
    return JSON.stringify(['git', 'inspect', root]);
  } catch { return undefined; }
}
