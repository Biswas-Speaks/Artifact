import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { STORIES } from '@/lib/stories';
import { StoryExperience } from './StoryExperience';

export function ShapeStories() {
  const [selected, setSelected] = useState<string | null>(null);
  const story = STORIES.find(s => s.slug === selected);
  return <section className="mx-auto max-w-6xl px-6 pb-20 pt-12">
    <div className="mb-10 flex items-end justify-between gap-4"><div><p className="mb-4 font-mono text-xs text-accent">A COLLECTION IN MOTION</p><h2 className="font-display text-3xl font-semibold sm:text-4xl">Small shapes. Big stories.</h2></div><Link to="/artifacts" className="hidden items-center gap-2 text-sm sm:flex">All artifacts <ArrowUpRight size={16} /></Link></div>
    <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-6">{STORIES.map(s => <Button key={s.slug} variant="ghost" className={`shape-story story-${s.color} flex h-auto flex-col gap-5 p-2 hover:bg-transparent hover:text-foreground`} onClick={() => setSelected(s.slug)}><span aria-hidden="true" className={`story-shape story-shape-${s.shape}`}><span className="shape-face"><i /><i /><b /></span></span><span className="text-center"><span className="block font-display text-sm font-semibold">{s.title}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{s.caption}</span></span></Button>)}</div>
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="max-h-[90svh] w-[calc(100%-24px)] max-w-4xl overflow-y-auto p-0"><div className="px-6 pt-6"><DialogTitle>{story?.title}</DialogTitle><DialogDescription className="mt-1">An interactive story · illustrative sample</DialogDescription></div>{selected && <StoryExperience key={selected} slug={selected} />}</DialogContent></Dialog>
  </section>;
}