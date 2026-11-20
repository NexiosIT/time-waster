import { basename } from 'node:path';
import { openDb, board, deletePlayer, playerIdByLogin, playersWithLogin, setBlocked, deleteScore, type Db } from './db';

const USAGE = [
  'Usage: admin.js <command>',
  '  board <game>',
  '  delete-score <login> <game>',
  '  delete-player <login>',
  '  block <login>',
  '  unblock <login>',
];

export function runAdmin(db: Db, argv: string[], out: (line: string) => void): number {
  const [cmd, ...args] = argv;
  const usage = () => {
    USAGE.forEach(out);
    return 1;
  };
  const fail = (msg: string) => {
    out(msg);
    return 1;
  };
  // Resolve a login to exactly one player, or say why not.
  const unique = (login: string): string | null => {
    const n = playersWithLogin(db, login);
    if (n === 0) return `unknown login: ${login}`;
    if (n > 1) return `more than one player matches login: ${login}`;
    return null;
  };

  switch (cmd) {
    case 'board': {
      if (args.length !== 1) return usage();
      board(db, args[0], 100).top.forEach((r) => out(`${r.rank} ${r.login} ${r.score}`));
      return 0;
    }
    case 'delete-score': {
      if (args.length !== 2) return usage();
      const err = unique(args[0]);
      if (err) return fail(err);
      if (!deleteScore(db, args[0], args[1])) return fail(`${args[0]} has no score for ${args[1]}`);
      out(`deleted ${args[0]} ${args[1]}`);
      return 0;
    }
    case 'delete-player': {
      if (args.length !== 1) return usage();
      const err = unique(args[0]);
      if (err) return fail(err);
      deletePlayer(db, playerIdByLogin(db, args[0]) as number);
      out(`deleted ${args[0]}`);
      return 0;
    }
    case 'block':
    case 'unblock': {
      if (args.length !== 1) return usage();
      const err = unique(args[0]);
      if (err) return fail(err);
      setBlocked(db, args[0], cmd === 'block');
      out(`${cmd}ed ${args[0]}`);
      return 0;
    }
    default:
      return usage();
  }
}

// Run only as the bundled entry point, not when imported by tests.
if (/^admin\.(js|ts)$/.test(basename(process.argv[1] ?? ''))) {
  const db = openDb(process.env.DB_PATH ?? '/data/scores.db');
  process.exitCode = runAdmin(db, process.argv.slice(2), (l) => console.log(l));
}
