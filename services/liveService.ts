import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from "@google/genai";
import { base64ToUint8Array, float32ToInt16PCM, arrayBufferToBase64, pcmToAudioBuffer } from "../utils/audio";
import { LogEntry } from "../types";

// Configuration
const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// --- MOCK DATA ---
const MOCK_FINANCIAL_PROFILE = {
  user: "Alex Chen",
  accounts: {
    checking: { balance: 2450.50, currency: "USD", status: "Active" },
    savings: { balance: 12800.00, currency: "USD", interestRate: "4.5%" },
    creditCard: { balance: 450.20, limit: 5000, dueDate: "2023-11-15" }
  },
  recentTransactions: [
    { id: 1, date: "2023-10-25", merchant: "Starbucks", amount: 15.50, category: "Dining" },
    { id: 2, date: "2023-10-24", merchant: "Whole Foods", amount: 142.30, category: "Groceries" },
    { id: 3, date: "2023-10-24", merchant: "Uber", amount: 24.00, category: "Transport" },
    { id: 4, date: "2023-10-22", merchant: "Netflix", amount: 15.99, category: "Entertainment" },
    { id: 5, date: "2023-10-20", merchant: "City Utility", amount: 120.00, category: "Bills" }
  ],
  budget: {
    monthlyLimit: 3000,
    currentSpending: 2150,
    categories: {
      Dining: { limit: 400, spent: 380, warning: true },
      Groceries: { limit: 600, spent: 450, warning: false }
    }
  }
};

// --- TOOL DEFINITIONS ---

const getFinancialProfileTool: FunctionDeclaration = {
  name: "get_financial_profile",
  description: "Retrieve the user's current financial data including account balances, recent transactions, and budget status. Use this to give personalized financial advice.",
  parameters: {
    type: Type.OBJECT,
    properties: {}, // No parameters needed as it fetches the current authenticated user's data
  }
};

const googleSearchTool: FunctionDeclaration = {
  name: "google_search",
  description: "Search the web for current financial news, stock prices, interest rates, or general knowledge.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: "The search query to execute."
      }
    },
    required: ["query"]
  }
};

type StatusCallback = (isConnected: boolean) => void;
type LogCallback = (log: LogEntry) => void;
type VolumeCallback = (volume: number) => void;

export class LiveService {
  private client: GoogleGenAI;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private nextStartTime = 0;
  private isConnected = false;
  
  // Callbacks
  private onStatusChange: StatusCallback;
  private onLog: LogCallback;
  private onVolume: VolumeCallback;

  // Track session promise to avoid closure staleness
  private sessionPromise: Promise<any> | null = null;

  constructor(apiKey: string, onStatusChange: StatusCallback, onLog: LogCallback, onVolume: VolumeCallback) {
    this.client = new GoogleGenAI({ apiKey });
    this.onStatusChange = onStatusChange;
    this.onLog = onLog;
    this.onVolume = onVolume;
  }

  public async connect() {
    if (this.isConnected) return;

    try {
      this.onLog({ timestamp: new Date(), type: 'system', message: 'Initializing audio context...' });
      
      // 1. Setup Input Audio (Mic)
      // Use standard AudioContext
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.inputAudioContext = new AudioContextClass({
        sampleRate: INPUT_SAMPLE_RATE,
      });
      
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: INPUT_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      // 2. Setup Output Audio (Speaker)
      this.outputAudioContext = new AudioContextClass({
        sampleRate: OUTPUT_SAMPLE_RATE,
      });

      this.onLog({ timestamp: new Date(), type: 'system', message: 'Connecting to Gemini Live API...' });

      // 3. Connect to Live API
      this.sessionPromise = this.client.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `You are Alex's dedicated Financial Coach. 
          Your goal is to help Alex manage their finances, save money, and stay within budget.
          You have access to Alex's real-time financial profile via the 'get_financial_profile' tool. 
          ALWAYS call 'get_financial_profile' if Alex asks about their balance, spending, or budget. 
          Do not guess numbers.
          You can also use 'google_search' to look up current market rates, stock prices, or financial news to support your advice.
          Keep your responses encouraging, professional, yet conversational and concise.`,
          tools: [{ functionDeclarations: [getFinancialProfileTool, googleSearchTool] }]
        },
        callbacks: {
          onopen: this.handleOpen.bind(this),
          onmessage: this.handleMessage.bind(this),
          onclose: this.handleClose.bind(this),
          onerror: this.handleError.bind(this),
        }
      });
      
      // Wait for the connection to be established implicitly via the promise, 
      // but note that 'onopen' is what flags us as truly ready.
      // However, if the promise rejects (Network Error), we catch it below.
      await this.sessionPromise;

    } catch (error: any) {
      console.error("Connection failed:", error);
      let msg = error.message || "Unknown connection error";
      if (msg.includes("Network")) {
        msg = "Network Error: Check API Key and Internet Connection.";
      }
      this.onLog({ timestamp: new Date(), type: 'system', message: `Connection failed: ${msg}` });
      await this.disconnect();
    }
  }

  public async disconnect() {
    // If not connected and no session promise, nothing to do.
    if (!this.isConnected && !this.sessionPromise) return;
    
    // Stop audio processing immediately
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    
    // Close audio contexts
    if (this.inputAudioContext && this.inputAudioContext.state !== 'closed') {
      await this.inputAudioContext.close();
      this.inputAudioContext = null;
    }
    if (this.outputAudioContext && this.outputAudioContext.state !== 'closed') {
      await this.outputAudioContext.close();
      this.outputAudioContext = null;
    }

    // Explicitly close the session if it exists
    if (this.sessionPromise) {
      try {
        // If the promise is resolved, we can close the session.
        // If it's pending, it might resolve later, but we can't cancel the promise itself easily.
        // However, we can use the session object if we had stored it. 
        // The SDK doesn't expose a clean 'cancel', but calling the internal close if available helps.
        // For now, we rely on setting isConnected=false to ignore future messages.
        const session = await this.sessionPromise;
        // The SDK might not expose .close() on the session object returned by promise in all versions,
        // but typically it is handled via the context.
        // We will just let it be GC'd or rely on the fact that we cut the transport.
      } catch (e) {
        // Ignore errors during disconnect of a failed session
      }
    }

    this.isConnected = false;
    this.onStatusChange(false);
    this.onLog({ timestamp: new Date(), type: 'system', message: 'Disconnected.' });
    this.sessionPromise = null;
  }

  private handleOpen() {
    this.isConnected = true;
    this.onStatusChange(true);
    this.onLog({ timestamp: new Date(), type: 'system', message: 'Coach is ready. Listening...' });
    this.startAudioStreaming();
  }

  private startAudioStreaming() {
    if (!this.inputAudioContext || !this.mediaStream || !this.sessionPromise) return;

    this.source = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.isConnected) return; // Stop processing if disconnected

      const inputData = e.inputBuffer.getChannelData(0);
      
      // Calculate volume for visualizer
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);
      this.onVolume(rms * 100); 

      // Convert to PCM and stream
      const pcm16 = float32ToInt16PCM(inputData);
      const base64Data = arrayBufferToBase64(pcm16);

      this.sessionPromise?.then((session) => {
        if (this.isConnected) {
          session.sendRealtimeInput({
            media: {
              mimeType: 'audio/pcm;rate=16000',
              data: base64Data
            }
          });
        }
      }).catch(err => {
        // Ignore send errors, likely due to connection closing
      });
    };

    // Connect source -> processor -> destination (muted)
    const gainNode = this.inputAudioContext.createGain();
    gainNode.gain.value = 0;
    
    this.source.connect(this.processor);
    this.processor.connect(gainNode);
    gainNode.connect(this.inputAudioContext.destination);
  }

  private async handleMessage(message: LiveServerMessage) {
    if (!this.isConnected) return;

    try {
      // 1. Handle Tool Calls
      if (message.toolCall) {
        this.onLog({ timestamp: new Date(), type: 'system', message: 'Coach requesting data...' });
        
        for (const fc of message.toolCall.functionCalls) {
          
          let result: any = {};

          if (fc.name === 'get_financial_profile') {
            this.onLog({ timestamp: new Date(), type: 'tool', message: `Accessing secure financial profile...` });
            result = MOCK_FINANCIAL_PROFILE;
            this.onLog({ timestamp: new Date(), type: 'tool', message: `Retrieved data for: ${result.user}` });
          } 
          else if (fc.name === 'google_search') {
            const query = (fc.args as any).query;
            this.onLog({ timestamp: new Date(), type: 'tool', message: `Searching market info: "${query}"` });
            result = await this.mockGoogleSearch(query);
            this.onLog({ timestamp: new Date(), type: 'tool', message: `Found search results.` });
          }

          // Send response back
          this.sessionPromise?.then((session) => {
             if (this.isConnected) {
                session.sendToolResponse({
                  functionResponses: {
                    id: fc.id,
                    name: fc.name,
                    response: { result: result }
                  }
                });
             }
          });
        }
      }

      // 2. Handle Audio Response
      const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
      if (audioData && this.outputAudioContext) {
        // Decode audio
        const pcmBytes = base64ToUint8Array(audioData);
        const audioBuffer = pcmToAudioBuffer(pcmBytes.buffer, this.outputAudioContext, OUTPUT_SAMPLE_RATE);
        
        // Schedule playback
        this.nextStartTime = Math.max(this.outputAudioContext.currentTime, this.nextStartTime);
        
        const source = this.outputAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.outputAudioContext.destination);
        source.start(this.nextStartTime);
        
        this.nextStartTime += audioBuffer.duration;
      }
    } catch (e) {
      console.error("Error processing message:", e);
    }
  }

  private handleClose(e: CloseEvent) {
    this.onLog({ timestamp: new Date(), type: 'system', message: 'Session ended.' });
    this.disconnect();
  }

  private handleError(e: ErrorEvent) {
    // Extract meaningful error message if possible
    let errorMessage = 'An error occurred';
    if (e instanceof ErrorEvent && e.message) {
      errorMessage = e.message;
    } else if ((e as any).toString) {
      errorMessage = (e as any).toString();
    }
    
    this.onLog({ timestamp: new Date(), type: 'system', message: `API Error: ${errorMessage}` });
    console.error(e);
    this.disconnect();
  }

  private async mockGoogleSearch(query: string): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 800));
    const queryLower = query.toLowerCase();

    if (queryLower.includes("mortgage") || queryLower.includes("rate")) {
      return "Current 30-year fixed mortgage rates are around 7.2%. Fed interest rates are held steady at 5.25-5.50%.";
    }
    if (queryLower.includes("stock") || queryLower.includes("market")) {
      return "The S&P 500 is up 0.5% today. Tech stocks are leading the rally.";
    }
    
    return `Search results for "${query}": Recent financial news indicates stability in this sector. Consult specific trusted financial news outlets for real-time trading data.`;
  }
}