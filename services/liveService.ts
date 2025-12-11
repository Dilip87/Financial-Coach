import { GoogleGenAI, LiveServerMessage, Type, FunctionDeclaration, Modality } from "@google/genai";
import { base64ToUint8Array, float32ToInt16PCM, arrayBufferToBase64, pcmToAudioBuffer } from "../utils/audio";
import { LogEntry } from "../types";

// Configuration
const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const BUFFER_SIZE = 4096;

// AudioWorkletProcessor code
const RECORDER_WORKLET_CODE = `
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      this.port.postMessage(input[0]);
    }
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);
`;

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

const getFinancialProfileTool: FunctionDeclaration = {
  name: "get_financial_profile",
  description: "Retrieve the user's current financial data.",
  parameters: { type: Type.OBJECT, properties: {} }
};

const googleSearchTool: FunctionDeclaration = {
  name: "google_search",
  description: "Search the web for financial news.",
  parameters: {
    type: Type.OBJECT,
    properties: { query: { type: Type.STRING } },
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
  private workletNode: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private nextStartTime = 0;
  private isConnected = false;
  private audioBuffer = new Float32Array(BUFFER_SIZE);
  private audioBufferIdx = 0;
  
  // Cache the active session to avoid promise race conditions
  private currentSession: any = null;
  
  private onStatusChange: StatusCallback;
  private onLog: LogCallback;
  private onVolume: VolumeCallback;

  constructor(apiKey: string, onStatusChange: StatusCallback, onLog: LogCallback, onVolume: VolumeCallback) {
    this.client = new GoogleGenAI({ apiKey });
    this.onStatusChange = onStatusChange;
    this.onLog = onLog;
    this.onVolume = onVolume;
  }

  public async connect() {
    if (this.isConnected) return;

    this.isConnected = true;
    this.onStatusChange(true);

    try {
      this.onLog({ timestamp: new Date(), type: 'system', message: 'Initializing audio context...' });
      
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.inputAudioContext = new AudioContextClass({ sampleRate: INPUT_SAMPLE_RATE });
      this.outputAudioContext = new AudioContextClass({ sampleRate: OUTPUT_SAMPLE_RATE });

      if(this.inputAudioContext.state === 'suspended') {
        await this.inputAudioContext.resume();
      }
      if(this.outputAudioContext.state === 'suspended') {
        await this.outputAudioContext.resume();
      }

      try {
        const blob = new Blob([RECORDER_WORKLET_CODE], { type: 'application/javascript' });
        const workletUrl = URL.createObjectURL(blob);
        await this.inputAudioContext.audioWorklet.addModule(workletUrl);
      } catch (e) {
        console.error("AudioWorklet failed:", e);
        throw new Error("Could not initialize AudioWorklet.");
      }
      
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: { channelCount: 1, sampleRate: INPUT_SAMPLE_RATE, echoCancellation: true } 
      });
      
      this.onLog({ timestamp: new Date(), type: 'system', message: 'Connecting to Gemini Live API...' });

      // Connect
      const session = await this.client.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: "You are Alex's Financial Coach. Use 'get_financial_profile' for account data. Keep answers short.",
          tools: [{ functionDeclarations: [getFinancialProfileTool, googleSearchTool] }]
        },
        callbacks: {
          onopen: this.handleOpen.bind(this),
          onmessage: this.handleMessage.bind(this),
          onclose: this.handleClose.bind(this),
          onerror: this.handleError.bind(this),
        }
      });
      
      if (!this.isConnected) {
        console.log("Disconnected while connecting. Closing session immediately.");
        return;
      }

      this.currentSession = session;
      this.startAudioStreaming();

    } catch (error: any) {
      this.handleConnectionError(error);
    }
  }

  private handleConnectionError(error: any) {
    console.error("Connection failed:", error);
    let msg = error.message || "Unknown error";
    if (msg.includes("403") || msg.includes("API key")) msg = "Invalid API Key or unauthorized.";
    if (msg.includes("404")) msg = "Model not found. Check model name.";
    // "Network Error" often comes from the underlying fetch/websocket failure
    if (msg.includes("Network Error") || msg.includes("Failed to fetch")) msg = "Network Error: Check internet connection or firewall.";
    
    this.onLog({ timestamp: new Date(), type: 'system', message: `Connection failed: ${msg}` });
    this.disconnect();
  }

  public async disconnect() {
    this.isConnected = false;
    this.currentSession = null;
    this.onStatusChange(false);
    
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    
    if (this.inputAudioContext) await this.inputAudioContext.close();
    if (this.outputAudioContext) await this.outputAudioContext.close();
    this.inputAudioContext = null;
    this.outputAudioContext = null;

    this.onLog({ timestamp: new Date(), type: 'system', message: 'Disconnected.' });
  }

  private handleOpen() {
    this.onLog({ timestamp: new Date(), type: 'system', message: 'Coach is ready. Listening...' });
  }

  private startAudioStreaming() {
    if (!this.inputAudioContext || !this.mediaStream) return;

    this.source = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
    this.workletNode = new AudioWorkletNode(this.inputAudioContext, 'recorder-processor');
    
    this.workletNode.port.onmessage = (event) => {
      if (!this.isConnected) return;
      this.processInputAudio(event.data);
    };

    this.source.connect(this.workletNode);
    this.workletNode.connect(this.inputAudioContext.destination);
  }

  private processInputAudio(chunk: Float32Array) {
    if (!this.isConnected) return;

    let chunkIdx = 0;
    while (chunkIdx < chunk.length) {
      const space = this.audioBuffer.length - this.audioBufferIdx;
      const copyLen = Math.min(space, chunk.length - chunkIdx);
      this.audioBuffer.set(chunk.subarray(chunkIdx, chunkIdx + copyLen), this.audioBufferIdx);
      this.audioBufferIdx += copyLen;
      chunkIdx += copyLen;

      if (this.audioBufferIdx >= this.audioBuffer.length) {
        this.sendAudioChunk(this.audioBuffer);
        this.audioBufferIdx = 0;
      }
    }
  }

  private sendAudioChunk(float32Data: Float32Array) {
    if (!this.isConnected || !this.currentSession) return;

    try {
      // Visualizer volume calculation
      let sum = 0;
      for (let i = 0; i < float32Data.length; i += 4) {
        sum += float32Data[i] * float32Data[i];
      }
      const rms = Math.sqrt(sum / (float32Data.length / 4));
      this.onVolume(rms * 100); 

      const pcm16 = float32ToInt16PCM(float32Data);
      const base64Data = arrayBufferToBase64(pcm16);

      this.currentSession.sendRealtimeInput({
        media: { mimeType: 'audio/pcm;rate=16000', data: base64Data }
      });

    } catch (e: any) {
      if (e.message && (e.message.includes("closed") || e.message.includes("CLOSING"))) {
         this.disconnect();
      } else {
        console.warn("Send error:", e);
      }
    }
  }

  private async handleMessage(message: LiveServerMessage) {
    if (!this.isConnected) return;

    try {
      if (message.toolCall) {
        for (const fc of message.toolCall.functionCalls) {
          let result: any = {};
          if (fc.name === 'get_financial_profile') {
            result = MOCK_FINANCIAL_PROFILE;
            this.onLog({ timestamp: new Date(), type: 'tool', message: `Read data: ${result.user}` });
          } else if (fc.name === 'google_search') {
            const query = (fc.args as any).query;
            this.onLog({ timestamp: new Date(), type: 'tool', message: `Search: "${query}"` });
            result = await this.mockGoogleSearch(query);
          }

          if (this.isConnected && this.currentSession) {
             try {
               this.currentSession.sendToolResponse({
                 functionResponses: { id: fc.id, name: fc.name, response: { result: result } }
               });
             } catch(e) { console.log('Failed to send tool response', e); }
          }
        }
      }

      const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
      if (audioData && this.outputAudioContext) {
        const pcmBytes = base64ToUint8Array(audioData);
        const audioBuffer = pcmToAudioBuffer(pcmBytes.buffer, this.outputAudioContext, OUTPUT_SAMPLE_RATE);
        
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
    this.onLog({ timestamp: new Date(), type: 'system', message: `Session ended. Code: ${e.code}` });
    this.disconnect();
  }

  private handleError(e: ErrorEvent) {
    this.onLog({ timestamp: new Date(), type: 'system', message: `API Error encountered.` });
    console.error(e);
    this.disconnect();
  }

  private async mockGoogleSearch(query: string): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 800));
    return `Search results for "${query}": Recent financial data indicates stability.`;
  }
}