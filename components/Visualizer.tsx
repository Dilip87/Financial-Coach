import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isActive: boolean;
  volume: number; // 0 to 100
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, volume }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let bars = 5; // Number of bars
    const spacing = 10;
    const barWidth = 15;
    
    // Center the drawing
    const startX = (canvas.width - (bars * barWidth + (bars - 1) * spacing)) / 2;
    const centerY = canvas.height / 2;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!isActive) {
        // Idle state: straight line
        ctx.fillStyle = '#475569'; // Slate 600
        for (let i = 0; i < bars; i++) {
           const x = startX + i * (barWidth + spacing);
           ctx.beginPath();
           ctx.roundRect(x, centerY - 2, barWidth, 4, 2);
           ctx.fill();
        }
        return;
      }

      // Active state: Animate based on volume
      const time = Date.now() / 100;
      
      for (let i = 0; i < bars; i++) {
        // Create a wave effect combined with volume
        const offset = Math.sin(time + i); 
        const heightMultiplier = Math.max(0.2, (volume / 50)) * (1 + offset * 0.3);
        const h = Math.min(100, 20 * heightMultiplier); 
        
        const x = startX + i * (barWidth + spacing);
        
        // Gradient color
        const gradient = ctx.createLinearGradient(0, centerY - h/2, 0, centerY + h/2);
        gradient.addColorStop(0, '#60a5fa'); // Blue 400
        gradient.addColorStop(1, '#3b82f6'); // Blue 500
        
        ctx.fillStyle = gradient;
        
        ctx.beginPath();
        ctx.roundRect(x, centerY - h / 2, barWidth, h, 4);
        ctx.fill();
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isActive, volume]);

  return (
    <canvas 
      ref={canvasRef} 
      width={300} 
      height={150} 
      className="w-full max-w-[300px] h-[150px]"
    />
  );
};

export default Visualizer;