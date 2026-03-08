/**
 * AvatarSection - Animated Dr. Snuggles Bear Avatar
 * Restored from original DrSnugglesControlCenter.tsx
 * 
 * Features:
 * - SVG bear with blinking eyes
 * - Animated mouth (responds to audio level)
 * - Cigarette with glow
 * - Smoke particles
 * - CIA shirt label
 */

import React, { useRef, useEffect, useState } from 'react';
import type { VADStatus } from '../types';

interface AvatarSectionProps {
    vadStatus: VADStatus;
    audioLevel: number;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    systemStatus: string;
    isLive: boolean;
    isConnecting: boolean;
    onToggleConnection: () => void;
}

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    size: number;
}

export const AvatarSection: React.FC<AvatarSectionProps> = React.memo(({
    vadStatus,
    audioLevel,
    isCollapsed,
    onToggleCollapse,
    systemStatus,
    isLive,
    isConnecting,
    onToggleConnection
}) => {
    const [blinkState, setBlinkState] = useState(false);
    const [mouthOpen, setMouthOpen] = useState(0);
    const smokeCanvasRef = useRef<HTMLCanvasElement>(null);
    const particlesRef = useRef<Particle[]>([]);
    const animationFrameRef = useRef<number>();

    // Blinking animation
    useEffect(() => {
        const blinkInterval = setInterval(() => {
            setBlinkState(true);
            setTimeout(() => setBlinkState(false), 150);
        }, 3000 + Math.random() * 2000);

        return () => clearInterval(blinkInterval);
    }, []);

    // Mouth animation based on audio level
    useEffect(() => {
        const target = audioLevel / 100;
        setMouthOpen(prev => prev + (target - prev) * 0.3);
    }, [audioLevel]);

    // Smoke particle animation
    useEffect(() => {
        if (isCollapsed) return;

        const canvas = smokeCanvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const animate = () => {
            ctx.clearRect(0, 0, 200, 200);

            // Add new particles from cigarette tip
            if (Math.random() < 0.3) {
                particlesRef.current.push({
                    x: 155,
                    y: 134,
                    vx: (Math.random() - 0.5) * 0.5,
                    vy: -0.5 - Math.random() * 0.5,
                    life: 1,
                    size: 2 + Math.random() * 2
                });
            }

            // Update and draw particles
            particlesRef.current = particlesRef.current.filter(p => {
                p.x += p.vx;
                p.y += p.vy;
                p.life -= 0.01;
                p.vx *= 0.99;
                p.vy *= 0.99;

                if (p.life > 0) {
                    ctx.fillStyle = `rgba(200, 200, 200, ${p.life * 0.3})`;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    ctx.fill();
                    return true;
                }
                return false;
            });

            // Cigarette glow based on audio
            const cigaretteGlow = audioLevel / 100;
            if (cigaretteGlow > 0.1) {
                const glowGrad = ctx.createRadialGradient(155, 134, 0, 155, 134, 8 * cigaretteGlow);
                glowGrad.addColorStop(0, `rgba(255, 102, 0, ${cigaretteGlow})`);
                glowGrad.addColorStop(1, 'rgba(255, 102, 0, 0)');
                ctx.fillStyle = glowGrad;
                ctx.beginPath();
                ctx.arc(155, 134, 8 * cigaretteGlow, 0, Math.PI * 2);
                ctx.fill();
            }

            animationFrameRef.current = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [isCollapsed, audioLevel]);

    return (
        <div className="section">
            <div className="section-header-row">
                <div className="section-header">🐻 DR. SNUGGLES</div>
                <button
                    className="collapse-btn"
                    onClick={onToggleCollapse}
                    aria-label="Toggle avatar section"
                >
                    {isCollapsed ? '▶' : '▼'}
                </button>
            </div>
            {!isCollapsed && (
                <>
                    <div className="avatar-container">
                        {/* Status Badge */}
                        <div
                            className="status-badge"
                            style={{
                                background: systemStatus === 'thinking' ? '#ffaa00' :
                                    systemStatus === 'listening' ? '#00ff88' :
                                        systemStatus === 'speaking' ? '#8a2be2' :
                                            systemStatus === 'offline' ? '#ff4444' : '#666',
                            }}
                        >
                            {systemStatus === 'thinking' ? '🧠 THINKING' :
                                systemStatus === 'listening' ? '👂 LISTENING' :
                                    systemStatus === 'speaking' ? '🗣 SPEAKING' :
                                        systemStatus === 'offline' ? '❌ OFFLINE' : 'IDLE'}
                        </div>

                        {/* Dr. Snuggles Avatar Image */}
                        <svg
                            viewBox="0 0 200 250"
                            className="avatar-svg-wrapper"
                            style={{
                                filter: systemStatus === 'offline' ? 'grayscale(100%)' : 'none',
                            }}
                        >
                            <defs>
                                <radialGradient id="furGradient" cx="50%" cy="40%">
                                    <stop offset="0%" stopColor="#E8B880" />
                                    <stop offset="70%" stopColor="#D4A574" />
                                    <stop offset="100%" stopColor="#B8906A" />
                                </radialGradient>
                                <radialGradient id="snoutGradient" cx="50%" cy="30%">
                                    <stop offset="0%" stopColor="#F5D4A8" />
                                    <stop offset="100%" stopColor="#E8C998" />
                                </radialGradient>
                                <radialGradient id="bodyGradient" cx="50%" cy="30%">
                                    <stop offset="0%" stopColor="#F0C490" />
                                    <stop offset="100%" stopColor="#D4A574" />
                                </radialGradient>
                                <radialGradient id="shirtGradient" cx="50%" cy="20%">
                                    <stop offset="0%" stopColor="#F8E8D0" />
                                    <stop offset="100%" stopColor="#E8D4B8" />
                                </radialGradient>
                            </defs>

                            <g transform={vadStatus.isListening ? 'rotate(2 100 120)' : 'rotate(0 100 120)'}>
                                <ellipse cx="100" cy="185" rx="50" ry="55" fill="url(#bodyGradient)" />
                                <ellipse cx="100" cy="185" rx="47" ry="52" fill="url(#shirtGradient)" />
                                <ellipse cx="56" cy="175" rx="16" ry="40" fill="url(#furGradient)" transform="rotate(-12 56 175)" />
                                <ellipse cx="144" cy="175" rx="16" ry="40" fill="url(#furGradient)" transform="rotate(12 144 175)" />
                                <rect x="80" y="140" width="40" height="25" fill="url(#furGradient)" rx="8" />
                                <circle cx="58" cy="68" r="20" fill="url(#furGradient)" />
                                <circle cx="142" cy="68" r="20" fill="url(#furGradient)" />
                                <circle cx="58" cy="70" r="11" fill="#B8906A" opacity="0.7" />
                                <circle cx="142" cy="70" r="11" fill="#B8906A" opacity="0.7" />
                                <circle cx="100" cy="105" r="58" fill="url(#furGradient)" />
                                <ellipse cx="100" cy="122" rx="36" ry="30" fill="url(#snoutGradient)" />
                                <ellipse cx="100" cy="115" rx="12" ry="11" fill="#2a1a10" />
                                <ellipse cx="98" cy="113" rx="4" ry="3" fill="#4a3020" opacity="0.5" />

                                {!blinkState ? (
                                    <>
                                        <circle cx="80" cy="95" r="8" fill="#1a0f08" />
                                        <circle cx="82" cy="93" r="2.5" fill="#3a2a18" opacity="0.6" />
                                        <circle cx="120" cy="95" r="8" fill="#1a0f08" />
                                        <circle cx="122" cy="93" r="2.5" fill="#3a2a18" opacity="0.6" />
                                    </>
                                ) : (
                                    <>
                                        <line x1="72" y1="95" x2="88" y2="95" stroke="#1a0f08" strokeWidth="2.5" strokeLinecap="round" />
                                        <line x1="112" y1="95" x2="128" y2="95" stroke="#1a0f08" strokeWidth="2.5" strokeLinecap="round" />
                                    </>
                                )}

                                <path d="M 70 84 Q 78 82 86 84" stroke="#3a2a18" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                                <path d="M 114 84 Q 122 82 130 84" stroke="#3a2a18" strokeWidth="2.5" fill="none" strokeLinecap="round" />

                                <line
                                    x1="82"
                                    y1={`${135 + mouthOpen * 5}`}
                                    x2="118"
                                    y2={`${135 + mouthOpen * 5}`}
                                    stroke="#2a1a10"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                />

                                <rect x="122" y="132" width="32" height="4" fill="#FFFFFF" rx="2" />
                                <rect x="122" y="133" width="32" height="2" fill="#F0F0F0" rx="1" opacity="0.6" />
                                <rect x="151" y="131" width="7" height="6" fill="#d89050" rx="1" />
                                <circle cx="155" cy="134" r="2" fill="#ff6600" />
                                <circle cx="155" cy="134" r="3" fill="#ff8833" opacity="0.4" />

                                <text x="100" y="175" fontSize="10" fontWeight="600" fill="#3a2a1a" textAnchor="middle" fontFamily="Arial, sans-serif">EMPLOYEE</text>
                                <text x="100" y="186" fontSize="9" fontWeight="600" fill="#3a2a1a" textAnchor="middle" fontFamily="Arial, sans-serif">OF THE YEAR:</text>
                                <text x="100" y="206" fontSize="22" fontWeight="900" fill="#C62828" textAnchor="middle" letterSpacing="1" fontFamily="Arial, sans-serif">CIA</text>
                            </g>
                        </svg>

                        <canvas
                            ref={smokeCanvasRef}
                            width={200}
                            height={250}
                            className="smoke-canvas-overlay"
                        />
                    </div>

                    <div className="status-buttons">
                       <button
                            className="primary-button"
                            style={{
                                backgroundColor: isLive ? '#ff4444' : '#00ff88',
                                width: '100%',
                                marginBottom: '10px'
                            }}
                            onClick={onToggleConnection}
                            disabled={isConnecting}
                        >
                            {isConnecting ? 'CONNECTING...' : isLive ? '🛑 END SESSION' : '🟢 START SESSION'}
                        </button>
                    </div>
                    
                    <div className="current-status">
                        Status: {vadStatus.isSpeaking ? 'Speaking' : vadStatus.isListening ? 'Listening' : 'Idle'}
                    </div>
                </>
            )}
        </div>
    );
});

AvatarSection.displayName = 'AvatarSection';
