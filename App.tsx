import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Power, Search, TrendingUp, Wallet, PieChart } from 'lucide-react';
import { LiveService } from './services/liveService';
import Visualizer from './components/Visualizer';
import LogViewer from './components/LogViewer';
import { LogEntry, ConnectionState } from './types';

function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [volume, setVolume] = useState(0);
  const liveServiceRef = useRef<LiveService | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);

  // Initialize service ref
  useEffect(() => {
    let apiKey = '';
    try {
      apiKey = process.env.API_KEY || '';
    } catch (e) {
      console.warn("process.env.API_KEY not available");
    }
    
    if (!apiKey) {
      addLog({ timestamp: new Date(), type: 'system', message: 'API_KEY not found in environment. Please set process.env.API_KEY.' });
      setHasApiKey(false);
    } else {
      setHasApiKey(true);
    }

    liveServiceRef.current = new LiveService(
      apiKey,
      (isConnected) => setConnectionState(isConnected ? ConnectionState.CONNECTED : ConnectionState.DISCONNECTED),
      addLog,
      setVolume
    );

    // Cleanup on unmount
    return () => {
      liveServiceRef.current?.disconnect();
    };
  }, []);

  const addLog = (log: LogEntry) => {
    setLogs(prev => [...prev, log]);
  };

  const handleConnectToggle = async () => {
    if (!liveServiceRef.current) return;
    
    if (!hasApiKey) {
      addLog({ timestamp: new Date(), type: 'system', message: 'Cannot connect: API Key is missing.' });
      return;
    }

    if (connectionState === ConnectionState.DISCONNECTED) {
      setConnectionState(ConnectionState.CONNECTING);
      await liveServiceRef.current.connect();
    } else {
      await liveServiceRef.current.disconnect();
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 md:p-8">
      
      {/* Header */}
      <header className="mb-6 text-center space-y-2">
        <div className="inline-flex items-center justify-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 mb-4">
           <span className="relative flex h-2 w-2">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${connectionState === ConnectionState.CONNECTED ? 'bg-emerald-400' : 'bg-slate-400'}`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${connectionState === ConnectionState.CONNECTED ? 'bg-emerald-500' : 'bg-slate-500'}`}></span>
          </span>
          <span className="text-xs font-medium text-slate-400 tracking-wider">
            {connectionState === ConnectionState.CONNECTED ? 'COACH ACTIVE' : 'OFFLINE'}
          </span>
        </div>
        <div className="flex items-center justify-center gap-3">
          <TrendingUp className="text-emerald-400" size={32} />
          <h1 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-400">
            Financial Coach
          </h1>
        </div>
        <p className="text-slate-400 max-w-md mx-auto text-sm">
          Voice-driven financial advice based on your personal data.
        </p>
      </header>

      {/* Main Content Grid */}
      <main className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-6 h-[600px]">
        
        {/* Left Panel: Visualizer & Controls */}
        <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-2xl p-8 flex flex-col items-center justify-between relative overflow-hidden">
          {/* Background decoration */}
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-emerald-500/5 to-cyan-500/5 pointer-events-none"></div>

          {/* User Profile Card (Mock) */}
          <div className="w-full bg-slate-800/50 rounded-lg p-3 border border-slate-700/50 flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold">AC</div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wide">Connected Account</div>
              <div className="text-sm font-medium text-slate-200">Alex Chen</div>
            </div>
            <div className="ml-auto text-emerald-400">
              <Wallet size={18} />
            </div>
          </div>

          <div className="z-10 w-full flex-1 flex flex-col items-center justify-center gap-8">
            <div className="relative group">
              <div className={`absolute -inset-1 rounded-full blur transition duration-500 ${connectionState === ConnectionState.CONNECTED ? 'bg-gradient-to-r from-emerald-600 to-cyan-600 opacity-30 group-hover:opacity-50' : 'opacity-0'}`}></div>
              <div className="relative bg-slate-950 rounded-3xl border border-slate-800 p-6 shadow-2xl">
                 <Visualizer isActive={connectionState === ConnectionState.CONNECTED} volume={volume} />
              </div>
            </div>

            <div className="flex flex-col items-center gap-4 text-center">
              <h2 className="text-xl font-semibold text-slate-200">
                {connectionState === ConnectionState.CONNECTED 
                  ? "I'm listening..." 
                  : "Start Session"}
              </h2>
              <p className="text-sm text-slate-500 max-w-xs">
                {connectionState === ConnectionState.CONNECTED 
                  ? "Ask about your checking balance, recent transactions, or for advice on how to save more." 
                  : "Connect to review your mock financial portfolio."}
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="z-10 w-full flex items-center justify-center gap-6 pt-8 border-t border-slate-800/50">
            <button
              onClick={handleConnectToggle}
              disabled={connectionState === ConnectionState.CONNECTING || !hasApiKey}
              className={`
                relative flex items-center justify-center w-16 h-16 rounded-full transition-all duration-300 shadow-lg
                ${connectionState === ConnectionState.CONNECTED 
                  ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/20' 
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20'}
                ${(connectionState === ConnectionState.CONNECTING || !hasApiKey) ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              <Power size={28} />
            </button>
          </div>
        </div>

        {/* Right Panel: Logs */}
        <div className="h-full">
          <LogViewer logs={logs} />
        </div>
      </main>

      <footer className="mt-8 text-center text-slate-600 text-xs">
        Gemini Financial Coach &bull; Mock Data Demo &bull; Not Professional Advice
      </footer>
    </div>
  );
}

export default App;