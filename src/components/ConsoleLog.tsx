import { useEffect, useRef } from 'react';
import { ProcessingLog } from '../types';
import { Terminal, ShieldClose, Trash } from 'lucide-react';

interface ConsoleLogProps {
  logs: ProcessingLog[];
  onClear: () => void;
}

export default function ConsoleLog({ logs, onClear }: ConsoleLogProps) {
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex flex-col font-mono h-[240px]">
      <div className="bg-slate-100/85 px-4 py-2.5 border-b border-slate-250/60 flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-600">
          <Terminal className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-[11px] font-bold tracking-wide uppercase text-slate-600">Post-Processing Live Terminal</span>
        </div>
        
        {logs.length > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] text-slate-500 hover:text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer flex items-center gap-1 font-sans"
          >
            <Trash className="w-3.5 h-3.5" />
            Clear
          </button>
        )}
      </div>

      <div className="p-4 flex-1 overflow-y-auto text-xs space-y-1.5 select-text selection:bg-blue-100">
        {logs.length === 0 ? (
          <div className="text-slate-400 h-full flex flex-col items-center justify-center text-center py-6">
            <span className="text-xs">SYSTEM READY &bull; Queue vacant</span>
          </div>
        ) : (
          logs.map((log) => {
            let textColor = 'text-slate-705';
            let prefix = '◇';
            
            if (log.type === 'success') {
              textColor = 'text-emerald-700';
              prefix = '✔';
            } else if (log.type === 'error') {
              textColor = 'text-rose-600 font-semibold';
              prefix = '✖';
            } else if (log.type === 'warning') {
              textColor = 'text-amber-700';
              prefix = '⚠';
            } else if (log.type === 'info') {
              textColor = 'text-slate-600';
              prefix = 'ℹ';
            }

            return (
              <div key={log.id} className="flex gap-2.5 items-start py-0.5 leading-relaxed hover:bg-slate-100/60 p-1 px-1.5 rounded transition-all">
                <span className="text-slate-400 select-none text-[10px]">
                  [{log.timestamp}]
                </span>
                <span className={`select-none ${textColor}`}>{prefix}</span>
                <span className={`${textColor} flex-1 text-[11px] whitespace-pre-wrap break-all font-mono`}>
                  {log.message}
                </span>
              </div>
            );
          })
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
}
