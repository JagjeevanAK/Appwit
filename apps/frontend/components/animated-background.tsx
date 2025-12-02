"use client";

export default function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-black">
      {/* Base gradient background */}
      <div className="absolute inset-0 bg-linear-to-br from-gray-900 via-neutral-900 to-black" />
      
      {/* Animated gradient orbs - much brighter and more visible */}
      <div className="absolute top-0 -left-40 w-[600px] h-[600px] rounded-full filter blur-[120px] opacity-40 animate-blob" style={{ backgroundColor: '#59544f' }} />
      <div className="absolute top-0 -right-40 w-[600px] h-[600px] rounded-full filter blur-[120px] opacity-40 animate-blob animation-delay-2000" style={{ backgroundColor: '#8a7f75' }} />
      <div className="absolute -bottom-40 left-20 w-[600px] h-[600px] rounded-full filter blur-[120px] opacity-40 animate-blob animation-delay-4000" style={{ backgroundColor: '#a69688' }} />
      <div className="absolute bottom-0 right-20 w-[600px] h-[600px] rounded-full filter blur-[120px] opacity-40 animate-blob animation-delay-6000" style={{ backgroundColor: '#6b625a' }} />
      
      {/* Noise overlay for texture */}
      <div 
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
}
