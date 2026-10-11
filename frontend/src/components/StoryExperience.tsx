import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getStory, QUIZZES, storyStep } from '@/lib/stories';
import { campusDemand } from '@/lib/showcases';
import { ParticleCanvas } from './ParticleCanvas';

export function StoryExperience({ slug }: { slug: string }) {
  const story = getStory(slug);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [occupancy, setOccupancy] = useState(65);
  const [answer, setAnswer] = useState<number | null>(null);
  if (!story) return null;
  const slide = story.slides[index];
  const quiz = QUIZZES[story.shape];
  if (!slide || !quiz) return null;
  const go = (next: number) => { setIndex(storyStep(next, 0)); setAnswer(null); };
  return <div className={`story-experience story-${story.color} ${paused ? 'story-paused' : ''}`} tabIndex={0} onKeyDown={e => { if ((e.target as HTMLElement).tagName === 'INPUT') return; if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); go(storyStep(index, e.key === 'ArrowRight' ? 1 : -1)); } }}>
    <div className="flex items-center justify-between border-b border-border px-5 py-3"><span className="font-mono text-xs text-muted-foreground">FIVE LITTLE CHAPTERS / {String(index + 1).padStart(2, '0')}</span><Button variant="ghost" size="icon" aria-label={paused ? 'Play story animation' : 'Pause story animation'} onClick={() => setPaused(!paused)}>{paused ? <Play /> : <Pause />}</Button></div>
    <div className="grid min-h-[380px] items-center gap-8 p-6 sm:p-10 md:grid-cols-2">
      <div key={index} className="animate-fade-up"><p className="story-label mb-5 font-mono text-xs uppercase">{story.title}</p><h2 className="font-display text-3xl font-semibold leading-tight sm:text-4xl">{slide.title}</h2><p className="mt-4 text-sm leading-relaxed text-muted-foreground">{slide.copy}</p></div>
      <div className="story-visual min-w-0 rounded-lg bg-secondary/50 p-5">
        {slide.type === 'quiz' ? <div><h3 className="mb-5 font-display text-xl">{quiz.question}</h3><div className="space-y-2">{quiz.options.map((option, i) => <Button key={option} variant={answer === i ? 'secondary' : 'outline'} className="h-auto min-h-11 w-full justify-start whitespace-normal text-left" onClick={() => setAnswer(i)}>{answer === i && i === quiz.answer && <Check />}{option}</Button>)}</div>{answer !== null && <p role="status" className="mt-4 text-sm">{answer === quiz.answer ? 'Correct! Nicely done.' : 'Not quite. Try another answer.'}</p>}</div> : slide.type === 'demand' ? <div><label htmlFor={`demand-${slug}`} className="flex justify-between gap-3 text-sm"><span>Building occupancy</span><b>{occupancy}%</b></label><input id={`demand-${slug}`} type="range" min="0" max="100" value={occupancy} className="my-6 w-full accent-accent" onChange={e => setOccupancy(Number(e.target.value))} /><p className="font-display text-5xl">{campusDemand(occupancy)} <span className="text-xl">kW</span></p><p className="mt-4 text-xs text-muted-foreground">Illustrative estimate · 120 kW + 2.4 kW per occupancy point</p></div> : slide.type === 'particles' ? <ParticleCanvas paused={paused} /> : <div className="imported-visual" dangerouslySetInnerHTML={{ __html: slide.visual }} />}
      </div>
    </div>
    <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-4"><Button variant="outline" size="icon" aria-label="Previous chapter" disabled={index === 0} onClick={() => go(index - 1)}><ArrowLeft /></Button><div className="flex gap-1">{story.slides.map((_, i) => <Button key={i} variant="ghost" size="icon" aria-label={`Chapter ${i + 1}`} aria-current={i === index ? 'step' : undefined} onClick={() => go(i)}><span className={`story-dot ${i === index ? 'story-dot-active' : ''}`} /></Button>)}</div><Button variant="outline" size="icon" aria-label="Next chapter" disabled={index === 4} onClick={() => go(index + 1)}><ArrowRight /></Button></div>
  </div>;
}