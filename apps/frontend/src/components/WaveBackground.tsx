'use client';

import { useEffect, useRef } from 'react';

interface Wave {
  amplitude: number;
  frequency: number;
  phase: number;
  speed: number;
  color: string;
  lineWidth: number;
  yOffset: number;
}

export function WaveBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // All waves in burgundy/crimson palette — project accent colours
    const waves: Wave[] = [
      { amplitude: 65,  frequency: 0.008, phase: 0,    speed: 0.012, color: 'rgba(107,31,42,0.70)',  lineWidth: 2.5, yOffset: 0.50 },
      { amplitude: 48,  frequency: 0.012, phase: 1.2,  speed: 0.018, color: 'rgba(138,42,54,0.55)',  lineWidth: 2.0, yOffset: 0.56 },
      { amplitude: 82,  frequency: 0.006, phase: 2.4,  speed: 0.008, color: 'rgba(107,31,42,0.35)',  lineWidth: 3.0, yOffset: 0.62 },
      { amplitude: 38,  frequency: 0.016, phase: 0.8,  speed: 0.022, color: 'rgba(160,50,65,0.45)',  lineWidth: 1.5, yOffset: 0.46 },
      { amplitude: 58,  frequency: 0.010, phase: 3.6,  speed: 0.014, color: 'rgba(80,20,30,0.50)',   lineWidth: 2.0, yOffset: 0.68 },
      { amplitude: 32,  frequency: 0.020, phase: 1.8,  speed: 0.028, color: 'rgba(138,42,54,0.30)',  lineWidth: 1.5, yOffset: 0.40 },
    ];

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const drawWave = (wave: Wave, t: number) => {
      const { width, height } = canvas;
      const baseY = height * wave.yOffset;

      ctx.beginPath();
      ctx.lineWidth = wave.lineWidth;
      ctx.strokeStyle = wave.color;

      for (let x = 0; x <= width; x += 2) {
        const y =
          baseY +
          Math.sin(x * wave.frequency + wave.phase + t * wave.speed) * wave.amplitude +
          Math.sin(x * wave.frequency * 1.7 + wave.phase * 0.5 + t * wave.speed * 0.6) * (wave.amplitude * 0.3);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    const drawFill = (wave: Wave, t: number) => {
      const { width, height } = canvas;
      const baseY = height * wave.yOffset;

      ctx.beginPath();
      for (let x = 0; x <= width; x += 2) {
        const y =
          baseY +
          Math.sin(x * wave.frequency + wave.phase + t * wave.speed) * wave.amplitude +
          Math.sin(x * wave.frequency * 1.7 + wave.phase * 0.5 + t * wave.speed * 0.6) * (wave.amplitude * 0.3);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();

      // Fill is a very subtle tint of the same burgundy
      const alpha = parseFloat(wave.color.match(/[\d.]+\)$/)?.[0] ?? '0.3') * 0.18;
      ctx.fillStyle = wave.color.replace(/[\d.]+\)$/, `${alpha})`);
      ctx.fill();
    };

    const render = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      // Deep dark background — near-black with a warm burgundy undertone
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0,   '#1A1010');
      bg.addColorStop(0.5, '#1C1212');
      bg.addColorStop(1,   '#110C0C');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // Soft radial glow centred on the hero text area
      const cx = width / 2;
      const cy = height * 0.40;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, width * 0.50);
      glow.addColorStop(0,   'rgba(107,31,42,0.22)');
      glow.addColorStop(0.5, 'rgba(107,31,42,0.08)');
      glow.addColorStop(1,   'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // Fills first (bottom layers), then strokes on top
      [...waves].reverse().forEach(w => drawFill(w, timeRef.current));
      waves.forEach(w => drawWave(w, timeRef.current));

      timeRef.current += 1;
      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
      }}
    />
  );
}
