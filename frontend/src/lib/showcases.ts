export const QUARTER_REVENUE = {
  Q1: [42, 48, 56],
  Q2: [61, 68, 79],
  Q3: [76, 89, 104],
  Q4: [108, 124, 142],
};

export type Quarter = keyof typeof QUARTER_REVENUE;

export function revenueTotal(quarter: Quarter) {
  return QUARTER_REVENUE[quarter].reduce((sum, value) => sum + value, 0);
}

export function campusDemand(occupancy: number) {
  return Math.round(120 + occupancy * 2.4);
}

export const LEARNING_ANSWER = "Solar panels";

export const USE_CASES = [
  { sector: "Business & consulting", title: "Quarterly business review", slug: "business-review", copy: "Revenue, regional performance, and a decision-ready presentation.", formats: "Report · Data · Presentation" },
  { sector: "Engineering & IT", title: "Smart Campus Infrastructure", slug: "smart-campus", copy: "Live energy estimates, equipment data, and connected-system architecture.", formats: "Simulation · Specs · Diagram" },
  { sector: "Education & research", title: "The renewable energy lab", slug: "energy-lab", copy: "A visual lesson with an energy-flow diagram and a short knowledge check.", formats: "Lesson · Diagram · Quiz" },
];