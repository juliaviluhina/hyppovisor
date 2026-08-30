# Development

```bash
npm test         # Vitest — pure logic: url policy, action queue, blocklist, truncation
npm run test:e2e # Playwright _electron — real app vs local fixture pages, offline
npm run lint
npm run format
```

The e2e suite needs the Electron binary (`npm install` fetches it) and a
display. It drives a real app instance through the same code paths the MCP tools
use.
