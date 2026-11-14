import type { DetectionKind } from "./types";

/**
 * The COCO classes that are animals (plus "person", handled separately).
 * WHY a fixed list: the detector also finds chairs, cups and cars. The app is
 * about living things, so everything else is ignored instead of cluttering the
 * screen with irrelevant boxes.
 */
const ANIMAL_CATEGORIES = new Set([
  "bird",
  "cat",
  "dog",
  "horse",
  "sheep",
  "cow",
  "elephant",
  "bear",
  "zebra",
  "giraffe",
]);

export interface CategoryInfo {
  label: string;
  kind: DetectionKind;
}

/** Map a raw COCO category to what we show on screen, or null to ignore it. */
export function classifyCategory(category: string): CategoryInfo | null {
  const name = category.trim().toLowerCase();

  if (name === "person") return { label: "Human", kind: "person" };

  if (ANIMAL_CATEGORIES.has(name)) {
    return { label: name.charAt(0).toUpperCase() + name.slice(1), kind: "animal" };
  }

  return null;
}
