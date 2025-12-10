import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';
import { Terminal, Activity, Server, User } from 'lucide-react';

interface LogViewerProps {
  logs: LogEntry[];
}

const LogViewer: React.FC<LogViewerProps> = ({ logs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'user': return <User size={14} className="text-blue-400" />;
      case 'agent': return <Server size={14} className="text-purple-400" />;
      case 'tool': return <Terminal size={14} className="text-orange-400" />;
      case 'system': return <Activity size={14} className="text-slate-400" />;
    }
  };

  const getColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'user': return 'text-blue-200';
      case 'agent': return 'text-purple-200';
      case 'tool': return 'text-orange-200 font-mono text-xs';
      case 'system': return 'text-slate-400 italic text-xs';
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-inner">
      <div className="bg-slate-800 px-4 py-2 border-b border-slate-700 flex items-center gap-2">
        <Terminal size={16} className="text-slate-400" />
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Agent Activity Log</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 font-sans">
        {logs.length === 0 && (
          <div className="text-center text-slate-600 text-sm py-10">
            Ready to connect. Logs will appear here.
          </div>
        )}
        {logs.map((log, i) => (
          <div key={i} className="flex items-start gap-3 animate-fade-in">
            <div className="mt-1 flex-shrink-0 opacity-70">
              {getIcon(log.type)}
            </div>
            <div className="flex-1">
              <p className={`leading-relaxed ${getColor(log.type)}`}>
                {log.message}
              </p>
              <span className="text-[10px] text-slate-600">
                {log.timestamp.toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LogViewer;