export type ArtifactCategory =
  | "Interactive Websites"
  | "Documents"
  | "Presentations"
  | "Code & Experiments"
  | "Visual Stories";

export interface Artifact {
  slug: string;
  title: string;
  category: ArtifactCategory;
  description: string;
  publishedAt: string;
  hue: number; // used to derive the generated preview artwork
  span?: boolean; // wide card in the asymmetric grid
}

export const CATEGORIES: Array<"All Creations" | ArtifactCategory> = [
  "All Creations",
  "Interactive Websites",
  "Documents",
  "Presentations",
  "Code & Experiments",
  "Visual Stories",
];

// Sample data — stands in for the published-artifacts API until the backend ships.
export const ARTIFACTS: Artifact[] = [
  {
    slug: "business-review",
    title: "Quarterly Business Review",
    category: "Presentations",
    description: "A five-chapter business review with revenue data, animated charts, regional breakdowns, and a quick knowledge check.",
    publishedAt: "2026-10-10",
    hue: 150,
  },
  {
    slug: "smart-campus",
    title: "Smart Campus Infrastructure",
    category: "Interactive Websites",
    description: "Explore a connected campus through system diagrams, sensor data, and an interactive energy-demand model.",
    publishedAt: "2026-10-10",
    hue: 200,
  },
  {
    slug: "energy-lab",
    title: "The Renewable Energy Lab",
    category: "Interactive Websites",
    description: "Follow sunlight from generation to storage, then test your understanding in a short interactive lesson.",
    publishedAt: "2026-10-10",
    hue: 90,
  },
  {
    slug: "orbital-tides",
    title: "Orbital Tides",
    category: "Interactive Websites",
    description:
      "A scroll-driven journey through gravitational physics, rendered as a living diagram.",
    publishedAt: "2026-09-18",
    hue: 262,
    span: true,
  },
  {
    slug: "field-notes-on-light",
    title: "Field Notes on Light",
    category: "Documents",
    description:
      "An editorial essay on optics and perception, typeset like a printed monograph.",
    publishedAt: "2026-08-30",
    hue: 40,
  },
  {
    slug: "signal-and-noise",
    title: "Signal & Noise",
    category: "Presentations",
    description:
      "A cinematic deck on information theory with animated transitions and 3D visuals.",
    publishedAt: "2026-08-12",
    hue: 200,
  },
  {
    slug: "particle-garden",
    title: "Particle Garden",
    category: "Code & Experiments",
    description:
      "Ten thousand particles responding to your cursor. A study in emergent motion.",
    publishedAt: "2026-07-25",
    hue: 150,
  },
  {
    slug: "monsoon-archive",
    title: "Monsoon Archive",
    category: "Visual Stories",
    description:
      "A photographic narrative of the Kolkata rains, told in layered imagery and sound.",
    publishedAt: "2026-06-14",
    hue: 215,
    span: true,
  },
  {
    slug: "typographic-machines",
    title: "Typographic Machines",
    category: "Code & Experiments",
    description:
      "Generative letterforms built from springs, constraints, and a little chaos.",
    publishedAt: "2026-05-29",
    hue: 320,
  },
  {
    slug: "the-quiet-web",
    title: "The Quiet Web",
    category: "Documents",
    description:
      "A manifesto for slower, more deliberate publishing on the modern internet.",
    publishedAt: "2026-04-17",
    hue: 90,
  },
  {
    slug: "chromatic-scales",
    title: "Chromatic Scales",
    category: "Interactive Websites",
    description:
      "An audible color wheel — drag across hues to hear the harmony they form.",
    publishedAt: "2026-03-08",
    hue: 10,
  },
];

export function getArtifact(slug: string) {
  return ARTIFACTS.find((a) => a.slug === slug);
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
