# F3 Geographic Directory

Static TypeScript map app that visualizes F3 sectors, areas, regions, and AOs using polygons built from active workout locations.

## Features
- Initial view renders sector boundaries (excluding the International sector).
- Hover a polygon to see leadership positions and contact info.
- Click a polygon to drill down to the next level (sector → area → region → AO).
- Boundaries are built from the convex hull of active locations.

## Configuration
The app uses the F3 Nation API. A bearer token is required.

- Default API key: `tackle`
- Override with environment variable: `VITE_F3_API_KEY`

Example `.env`:
```
VITE_F3_API_KEY=your-key-here
```

## Local Development
1. Install dependencies: `npm install`
2. Start dev server: `npm run dev`
3. Build: `npm run build`

## Deployment
This project is ready for static hosting (e.g., GitHub Pages). Set Vite base path if needed for your deployment target.
