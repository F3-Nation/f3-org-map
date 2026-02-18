// Utility logic extracted from main.ts
import type { Point } from './orgChart';

export function fuzzyScore(query: string, target: string): number | null {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) return null;
  const haystack = target.toLowerCase();
  let score = 0;
  let streak = 0;
  let qIndex = 0;

  for (let i = 0; i < haystack.length && qIndex < trimmedQuery.length; i += 1) {
    if (haystack[i] === trimmedQuery[qIndex]) {
      score += 1 + streak;
      if (i === 0 || haystack[i - 1] === ' ' || haystack[i - 1] === '-') {
        score += 2;
      }
      streak += 1;
      qIndex += 1;
    } else {
      streak = 0;
    }
  }

  if (qIndex < trimmedQuery.length) return null;
  return score - haystack.length * 0.01;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
}

export function convexHull(points: Point[]): Point[] {
  if (points.length <= 1) return points;
  const sorted = [...points].sort((p1, p2) => (p1.lng === p2.lng ? p1.lat - p2.lat : p1.lng - p2.lng));
  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
