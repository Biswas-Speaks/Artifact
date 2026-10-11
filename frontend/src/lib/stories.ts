import imported from './imported-stories.json';

export const STORIES = imported;
export function getStory(slug: string) { return STORIES.find(story => story.slug === slug); }
export const QUIZZES = [
  { question: 'Which quarter grew fastest over the previous one?', options: ['Q2 (+42%)', 'Q3 (+29%)', 'Q4 (+39%)'], answer: 0 },
  { question: 'Demand at 100% occupancy is about…', options: ['300 kW', '360 kW', '480 kW'], answer: 1 },
  { question: 'What converts sunlight into electricity?', options: ['Solar panels', 'Battery storage', 'Power inverter'], answer: 0 },
  { question: 'Spring tides happen at…', options: ['Quarter moons', 'New and full moons', 'Only at noon'], answer: 1 },
  { question: 'Which month is wettest in this example?', options: ['June', 'August', 'October'], answer: 1 },
  { question: 'What makes particles flee your cursor?', options: ['A repel force', 'Gravity', 'Wind'], answer: 0 },
];
export function storyStep(index: number, change: number) { return Math.max(0, Math.min(4, index + change)); }