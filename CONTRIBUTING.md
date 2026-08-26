# Contributing

Use Node.js 20 or newer.

```bash
npm install
npm run check
npm pack --dry-run
```

Keep SSH access read-only and bounded. New tools must not expose arbitrary hosts, arbitrary shell commands, password prompts, sudo, or remote file mutation. Update `marketplace-entry.yml` when the repository URL, category, or public description changes.
