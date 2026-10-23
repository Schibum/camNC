import { getCncApi } from '@/lib/fluidnc/machine';
import { Button } from '@wbcnc/ui/components/button';
import { Checkbox } from '@wbcnc/ui/components/checkbox';
import { Input } from '@wbcnc/ui/components/input';
import { Label } from '@wbcnc/ui/components/label';
import { cn } from '@wbcnc/ui/lib/utils';
import type { ConsoleLine } from '@wbcnc/fluidnc';
import { useEffect, useRef, useState } from 'react';

const kKindClass: Record<ConsoleLine['kind'], string> = {
  sent: 'text-blue-600 dark:text-blue-400',
  ok: 'text-muted-foreground',
  error: 'text-red-600 font-semibold',
  alarm: 'bg-red-600 text-white font-semibold px-1 rounded',
  msg: 'text-amber-700 dark:text-amber-400',
  reset: 'text-purple-600',
  data: '',
};

export function ConsolePanel() {
  'use no memo';
  const api = getCncApi();
  const lines = api.consoleLines.value;
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [showOk, setShowOk] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines.length]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const line = input.trim();
    if (!line) return;
    setHistory(h => [...h.filter(l => l !== line), line].slice(-50));
    setHistoryIndex(null);
    setInput('');
    // Errors show up in the console itself.
    api.sendLines(line, 0).catch(() => {});
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    if (!history.length) return;
    const current = historyIndex ?? history.length;
    const next = Math.max(0, Math.min(history.length, current + (e.key === 'ArrowUp' ? -1 : 1)));
    setHistoryIndex(next === history.length ? null : next);
    setInput(next === history.length ? '' : history[next]!);
  }

  const visible = showOk ? lines : lines.filter(l => l.kind !== 'ok');
  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      <div ref={scrollRef} className="h-48 overflow-y-auto rounded border bg-muted/30 p-2 font-mono text-xs" data-testid="machine-console">
        {visible.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            <span className={cn(kKindClass[line.kind])}>
              {line.kind === 'sent' ? '> ' : ''}
              {line.text}
            </span>
            {line.detail && <span className="text-red-600"> — {line.detail}</span>}
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="flex flex-row gap-2">
        <Input
          className="font-mono"
          placeholder={api.isConnected.value ? 'G-code or $ command' : 'Not connected'}
          disabled={!api.isConnected.value}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        <Button type="submit" disabled={!api.isConnected.value}>
          Send
        </Button>
      </form>
      <div className="flex flex-row gap-3 items-center">
        <Label className="text-xs flex flex-row gap-2 items-center">
          <Checkbox checked={showOk} onCheckedChange={v => setShowOk(v === true)} /> Show ok
        </Label>
        <Button size="sm" variant="ghost" onClick={() => api.clearConsole()}>
          Clear
        </Button>
      </div>
    </div>
  );
}
