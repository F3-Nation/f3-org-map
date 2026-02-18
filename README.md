
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

- **Local development**: Uses `http://localhost:3000/v1` (see proxy config in vite.config.ts)
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

---

## Deployment

This project is ready for static hosting (e.g., GitHub Pages, Netlify, Vercel).

### Deploy to GitHub Pages

1. Push to the `main` branch.
2. GitHub Actions workflow in `.github/workflows/deploy.yml` will build and deploy to Pages automatically.
3. Ensure the `base` option in `vite.config.ts` is set to `'./'` for correct asset paths.

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
