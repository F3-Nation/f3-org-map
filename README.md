
# F3 Geographic Directory

An interactive map application for visualizing F3 Nation's sectors, areas, regions, and AOs. Built with TypeScript, Vite, and Leaflet, it displays organizational boundaries and leadership info using polygons generated from active workout locations.

---

## Features

- **Interactive Map**: Visualizes F3's organizational structure (sector → area → region → AO) on a modern map UI.
- **Drill-down Navigation**: Click polygons to drill down through organizational levels.
- **Leadership Info**: Hover polygons to view leadership positions and contact details.
- **Convex Hull Boundaries**: Boundaries are generated from the convex hull of active locations.
- **Search**: Quickly find sectors, areas, or regions by name.
- **Responsive Design**: Works on desktop and mobile devices.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or newer recommended)
- [npm](https://www.npmjs.com/) (comes with Node.js)

### Installation

1. Clone the repository:
	```sh
	git clone https://github.com/your-org/f3-sector-map.git
	cd f3-sector-map
	```
2. Install dependencies:
	```sh
	npm install
	```

### Environment Configuration

The API base URL is set automatically:

- **Local development**: Defaults to `https://api.f3nation.com/v1` unless `VITE_API_BASE` is set.
- **Production (GitHub Pages, etc.)**: Uses `https://api.f3nation.com/v1`
- You can override this by setting the `VITE_API_BASE` environment variable in a `.env` file:
  ```env
  VITE_API_BASE=https://api.f3nation.com/v1
  ```

---

## Development

### Start the Dev Server

```sh
npm run dev
```
Visit [http://localhost:5173](http://localhost:5173) (or the port shown in your terminal).

### Build for Production

```sh
npm run build
```
Output will be in the `dist/` folder.

### Run Tests

```sh
npm run test
```
Tests are written with [Vitest](https://vitest.dev/).

### Lint and Format

```sh
npm run lint
npm run format
```

Linting and formatting are powered by Biome.

---

## Repository Automation

- Lefthook runs checks locally on `pre-commit` and validates commit messages on `commit-msg`.
- Commitlint enforces Conventional Commits (requirements below).
- Dependabot opens weekly updates for npm packages and GitHub Actions.
- Release Please creates/updates a release PR and updates `CHANGELOG.md`.
- The app header shows the current version and links to the changelog.

### Commitlint Requirements

Commit messages must follow Conventional Commits:

| Type | Description |
|------|-------------|
| `feat` | A new user-facing feature |
| `fix` | A bug fix |
| `perf` | A code change that improves performance |
| `refactor` | A code change that neither fixes a bug nor adds a feature |
| `style` | Changes that don't affect code meaning (whitespace, formatting, etc.) |
| `test` | Adding or correcting tests |
| `docs` | Documentation-only changes |
| `build` | Changes to the build system or external dependencies |
| `ci` | Changes to CI configuration files and scripts |
| `chore` | Maintenance tasks (deps, tooling, etc.) that don't modify src or tests |
| `revert` | Reverts a previous commit |

Examples:

```text
feat: add region deep-link support
fix: handle missing org points in map rendering
chore: update vite and vitest
docs: document release workflow
```

Breaking changes should use `!` or a `BREAKING CHANGE:` footer:

```text
feat!: remove legacy org endpoint
```

### Release Please Workflow

- Runs on push to `main`.
- Uses Conventional Commit history to determine semantic version bump.
- Opens or updates a release PR with version/changelog updates.
- When the release PR is merged, it creates a Git tag and GitHub Release.
- GitHub Pages deployment is triggered from that release tag (one deploy per release).

Version bump rules:

- Patch bump: `fix:` commits
- Minor bump: `feat:` commits
- Major bump: any breaking change, typically `feat!:` / `fix!:` / `refactor!:` or a commit with a `BREAKING CHANGE:` footer

Examples:

```text
fix: correct map sizing on tall sidebars        -> patch bump
feat: add in-app changelog modal                -> minor bump
feat!: remove legacy org route                  -> major bump
```

---

## Deployment

This project is ready for static hosting (e.g., GitHub Pages, Netlify, Vercel).

### Deploy to GitHub Pages

1. Merge regular work into `main`.
2. Release Please opens/updates a release PR.
3. Merge the release PR to create a Git tag and GitHub Release.
4. The release workflow builds and deploys GitHub Pages from that tag.
5. Optional: run `.github/workflows/deploy.yml` manually to redeploy current code.
6. Ensure the `base` option in `vite.config.ts` is set to `'./'` for correct asset paths.

---

## Project Structure

- `src/` – Main source code (TypeScript, CSS)
- `public/` – Static assets
- `index.html` – App entry point
- `vite.config.ts` – Vite configuration
- `README.md` – Project documentation

---

## Troubleshooting

- **API errors locally**: Make sure your backend is running at `localhost:3000` and supports the `/v1/org-chart` endpoint.
- **Module not found errors**: Run `npm install` to ensure all dependencies are installed.
- **Type errors for Vitest**: Ensure `vitest` is installed as a dev dependency.

---

## License

MIT License. See [LICENSE](LICENSE) if present.
