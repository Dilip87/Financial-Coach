/**
 * Decodes base64 string to Uint8Array.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes Uint8Array to base64 string.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts Float32 audio data (Web Audio API standard) to Int16 PCM (Gemini API requirement).
 */
export function float32ToInt16PCM(float32Data: Float32Array): ArrayBuffer {
  const int16Data = new Int16Array(float32Data.length);
  for (let i = 0; i < float32Data.length; i++) {
    // Clamp values to [-1, 1] before scaling
    const s = Math.max(-1, Math.min(1, float32Data[i]));
    int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16Data.buffer;
}

/**
 * Decodes raw PCM data into an AudioBuffer.
 */
export function pcmToAudioBuffer(
  pcmData: ArrayBuffer,
  audioContext: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): AudioBuffer {
  const dataInt16 = new Int16Array(pcmData);
  const frameCount = dataInt16.length / numChannels;
  const audioBuffer = audioContext.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return audioBuffer;
}