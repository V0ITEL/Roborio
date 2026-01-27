'use strict';

import { log } from './utils/logger.js';
import notify from './ui/notify.js';

export function initScrollAnimations() {
    try {
        // Respect user's motion preferences
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animate-in');
                    // Stop observing after animation for performance
                    observer.unobserve(entry.target);
                }
            });
        }, observerOptions);

        // If user prefers reduced motion, add all classes immediately
        if (prefersReducedMotion) {
            document.querySelectorAll('.pillar-card, .market-card, .faq-item, .usecase-card, .section-header, .hero-stat, .tokenomics-item, .tokenomics-stat, .tokenomics-chart, .roadmap-item').forEach(el => {
                el.classList.add('animate-in');
            });
            return; // Skip observer setup
        }

        // Pillar cards with stagger
        document.querySelectorAll('.pillar-card').forEach((el, index) => {
            el.style.transitionDelay = `${index * 0.15}s`;
            observer.observe(el);
        });

        // Market cards with stagger (reset per row)
        document.querySelectorAll('.market-card').forEach((card, index) => {
            card.style.transitionDelay = `${(index % 4) * 0.1}s`;
            observer.observe(card);
        });

        // FAQ items with stagger
        document.querySelectorAll('.faq-item').forEach((el, index) => {
            el.style.transitionDelay = `${(index % 2) * 0.1}s`;
            observer.observe(el);
        });

        // Tokenomics items with stagger
        document.querySelectorAll('.tokenomics-item').forEach((el, index) => {
            el.style.transitionDelay = `${index * 0.1}s`;
            observer.observe(el);
        });

        // Tokenomics chart
        document.querySelectorAll('.tokenomics-chart').forEach(el => {
            observer.observe(el);
        });

        // Tokenomics stats with stagger
        document.querySelectorAll('.tokenomics-stat').forEach((el, index) => {
            el.style.transitionDelay = `${index * 0.1}s`;
            observer.observe(el);
        });

        // Roadmap items with stagger
        document.querySelectorAll('.roadmap-item').forEach((el, index) => {
            el.style.transitionDelay = `${index * 0.15}s`;
            observer.observe(el);
        });

        // Usecase cards with stagger
        document.querySelectorAll('.usecase-card').forEach((el, index) => {
            el.style.transitionDelay = `${index * 0.1}s`;
            observer.observe(el);
        });

        // Section headers
        document.querySelectorAll('.section-header').forEach(el => {
            observer.observe(el);
        });

        // Hero stats
        document.querySelectorAll('.hero-stat').forEach((el, index) => {
            el.style.transitionDelay = `${index * 0.15}s`;
            observer.observe(el);
        });

        // AOS-style animations (data-aos attribute)
        const aosObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('aos-animate');
                    // Stop observing after animation for performance
                    aosObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

        document.querySelectorAll('[data-aos]').forEach(el => {
            aosObserver.observe(el);
        });

    } catch (e) {
        log.error('[Animations]', 'Scroll animations init failed:', e);
    }
}

export function initCustomCursor() {
    // Skip on touch devices
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return;

    const cursor = document.getElementById('cursor');
    const cursorDot = document.getElementById('cursorDot');

    if (!cursor || !cursorDot) return;

    let mouseX = 0, mouseY = 0;
    let cursorX = 0, cursorY = 0;

    // Track mouse position
    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;

        // Dot follows immediately
        cursorDot.style.left = mouseX + 'px';
        cursorDot.style.top = mouseY + 'px';
    });

    // Smooth cursor animation
    function animateCursor() {
        cursorX += (mouseX - cursorX) * 0.15;
        cursorY += (mouseY - cursorY) * 0.15;

        cursor.style.left = cursorX + 'px';
        cursor.style.top = cursorY + 'px';

        requestAnimationFrame(animateCursor);
    }
    animateCursor();

    // Hover effect on interactive elements
    const hoverTargets = document.querySelectorAll('a, button, .btn, .faq-question, .market-card, .usecase-card, .pillar-card, .tokenomics-item, .roadmap-content');

    hoverTargets.forEach(target => {
        target.addEventListener('mouseenter', () => cursor.classList.add('hover'));
        target.addEventListener('mouseleave', () => cursor.classList.remove('hover'));
    });

    // Click effect
    document.addEventListener('mousedown', () => cursor.classList.add('click'));
    document.addEventListener('mouseup', () => cursor.classList.remove('click'));

    // Hide when leaving window
    document.addEventListener('mouseleave', () => {
        cursor.classList.add('hidden');
        cursorDot.classList.add('hidden');
    });
    document.addEventListener('mouseenter', () => {
        cursor.classList.remove('hidden');
        cursorDot.classList.remove('hidden');
    });

    // Hide default cursor
    document.body.style.cursor = 'none';
    hoverTargets.forEach(el => el.style.cursor = 'none');
}

export function initParallax() {
    // Skip on mobile for performance
    if (window.innerWidth < 768) return;

    const parallaxLayers = document.querySelectorAll('.parallax-layer');
    if (!parallaxLayers.length) return;

    let ticking = false;

    function updateParallax() {
        const scrollY = window.scrollY;

        parallaxLayers.forEach(layer => {
            const speed = parseFloat(layer.dataset.speed) || 0.1;
            const yPos = -(scrollY * speed);
            layer.style.transform = `translateY(${yPos}px)`;
        });

        ticking = false;
    }

    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(updateParallax);
            ticking = true;
        }
    }, { passive: true });
}

export function initGSAPAnimations() {
    // Register ScrollTrigger plugin
    if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
        log.warn('[GSAP]', 'GSAP or ScrollTrigger not loaded');
        return;
    }

    gsap.registerPlugin(ScrollTrigger);
    

    // SAFE ANIMATIONS ONLY (no opacity/transform that hide elements)

    // 1. Parallax effect for hero background (SAFE - uses gsap.to)
    const heroGrid = document.querySelector('.hero-grid-bg');
    if (heroGrid) {
        gsap.to(heroGrid, {
            y: 200,
            ease: 'none',
            scrollTrigger: {
                trigger: '.hero',
                start: 'top top',
                end: 'bottom top',
                scrub: 1
            }
        });
        
    }

    // 2. Buttons hover scale effect (SAFE - only triggers on hover)
    const buttons = document.querySelectorAll('.btn');
    buttons.forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            gsap.to(btn, { scale: 1.05, duration: 0.3, ease: 'power2.out' });
        });
        btn.addEventListener('mouseleave', () => {
            gsap.to(btn, { scale: 1, duration: 0.3, ease: 'power2.out' });
        });
    });
    

    // TEMPORARILY DISABLED - gsap.from() causing elements to hide
    // Will re-implement with safer approach using CSS classes + gsap.to()
    /*
    // Animate Use Case cards with stagger
    const useCaseCards = document.querySelectorAll('.usecase-card');
    console.log('[GSAP] Found usecase cards:', useCaseCards.length);

    // Animate pillar cards
    const pillarCards = document.querySelectorAll('.pillar-card');
    console.log('[GSAP] Found pillar cards:', pillarCards.length);

    // Animate FAQ items
    const faqItems = document.querySelectorAll('.faq-item');
    console.log('[GSAP] Found FAQ items:', faqItems.length);

    // Animate section headers
    const sectionHeaders = document.querySelectorAll('.section-header');
    console.log('[GSAP] Found section headers:', sectionHeaders.length);
    */

    
}

export function initAsciiRobot() {
    // ============================================================
        // NOISE SHADER MATERIAL
        // ============================================================
        const NoiseVertexShader = `
            varying vec3 vNormal;
            varying vec2 vUv;
            varying vec4 vScreenPos;
        
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vUv = uv;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                vScreenPos = gl_Position;
            }
        `;

        const NoiseFragmentShader = `
            precision highp float;
        
            uniform float time;
            uniform vec2 resolution;
            uniform vec3 baseColor;
        
            varying vec3 vNormal;
            varying vec2 vUv;
            varying vec4 vScreenPos;
        
            vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
            vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
            vec2 fade(vec2 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
        
            float cnoise(vec2 P) {
                vec4 Pi = floor(P.xyxy) + vec4(0.0, 0.0, 1.0, 1.0);
                vec4 Pf = fract(P.xyxy) - vec4(0.0, 0.0, 1.0, 1.0);
                Pi = mod289(Pi);
                vec4 ix = Pi.xzxz; vec4 iy = Pi.yyww;
                vec4 fx = Pf.xzxz; vec4 fy = Pf.yyww;
                vec4 i = permute(permute(ix) + iy);
                vec4 gx = fract(i * (1.0 / 41.0)) * 2.0 - 1.0;
                vec4 gy = abs(gx) - 0.5;
                vec4 tx = floor(gx + 0.5);
                gx = gx - tx;
                vec2 g00 = vec2(gx.x, gy.x); vec2 g10 = vec2(gx.y, gy.y);
                vec2 g01 = vec2(gx.z, gy.z); vec2 g11 = vec2(gx.w, gy.w);
                vec4 norm = taylorInvSqrt(vec4(dot(g00, g00), dot(g01, g01), dot(g10, g10), dot(g11, g11)));
                g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
                float n00 = dot(g00, vec2(fx.x, fy.x)); float n10 = dot(g10, vec2(fx.y, fy.y));
                float n01 = dot(g01, vec2(fx.z, fy.z)); float n11 = dot(g11, vec2(fx.w, fy.w));
                vec2 fade_xy = fade(Pf.xy);
                vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
                return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
            }
        
            const int OCTAVES = 6;
            float fbm(vec2 p) {
                float value = 0.0; float amplitude = 0.5; float frequency = 2.0;
                for (int i = 0; i < OCTAVES; i++) {
                    value += amplitude * abs(cnoise(p));
                    p *= frequency; amplitude *= 0.5;
                }
                return value;
            }
        
            float pattern(vec2 p) {
                vec2 p2 = p - time * 0.03;
                vec2 p3 = p + cos(time * 0.08);
                return fbm(p2 + fbm(p3 + fbm(p)));
            }
        
            void main() {
                vec2 screenUV = (vScreenPos.xy / vScreenPos.w) * 0.5 + 0.5;
                screenUV.x *= resolution.x / resolution.y;
                float noiseValue = pattern(screenUV * 3.0);
                vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
                float NdotL = max(dot(normalize(vNormal), lightDir), 0.0);
                float lighting = 0.4 + 0.6 * NdotL;
                vec3 noiseColor = mix(vec3(0.7), vec3(1.1), noiseValue);
                vec3 finalColor = baseColor * noiseColor * lighting;
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;

        const NoiseFragmentShaderEmissive = `
            precision highp float;
            uniform float time;
            uniform vec2 resolution;
            uniform vec3 baseColor;
            varying vec3 vNormal;
            varying vec2 vUv;
            varying vec4 vScreenPos;
        
            vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
            vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
            vec2 fade(vec2 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
        
            float cnoise(vec2 P) {
                vec4 Pi = floor(P.xyxy) + vec4(0.0, 0.0, 1.0, 1.0);
                vec4 Pf = fract(P.xyxy) - vec4(0.0, 0.0, 1.0, 1.0);
                Pi = mod289(Pi);
                vec4 ix = Pi.xzxz; vec4 iy = Pi.yyww;
                vec4 fx = Pf.xzxz; vec4 fy = Pf.yyww;
                vec4 i = permute(permute(ix) + iy);
                vec4 gx = fract(i * (1.0 / 41.0)) * 2.0 - 1.0;
                vec4 gy = abs(gx) - 0.5;
                vec4 tx = floor(gx + 0.5);
                gx = gx - tx;
                vec2 g00 = vec2(gx.x, gy.x); vec2 g10 = vec2(gx.y, gy.y);
                vec2 g01 = vec2(gx.z, gy.z); vec2 g11 = vec2(gx.w, gy.w);
                vec4 norm = taylorInvSqrt(vec4(dot(g00, g00), dot(g01, g01), dot(g10, g10), dot(g11, g11)));
                g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
                float n00 = dot(g00, vec2(fx.x, fy.x)); float n10 = dot(g10, vec2(fx.y, fy.y));
                float n01 = dot(g01, vec2(fx.z, fy.z)); float n11 = dot(g11, vec2(fx.w, fy.w));
                vec2 fade_xy = fade(Pf.xy);
                vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
                return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
            }
        
            const int OCTAVES = 6;
            float fbm(vec2 p) {
                float value = 0.0; float amplitude = 0.5;
                for (int i = 0; i < OCTAVES; i++) {
                    value += amplitude * abs(cnoise(p));
                    p *= 2.0; amplitude *= 0.5;
                }
                return value;
            }
        
            float pattern(vec2 p) {
                vec2 p2 = p - time * 0.03;
                vec2 p3 = p + cos(time * 0.08);
                return fbm(p2 + fbm(p3 + fbm(p)));
            }
        
            void main() {
                vec2 screenUV = (vScreenPos.xy / vScreenPos.w) * 0.5 + 0.5;
                screenUV.x *= resolution.x / resolution.y;
                float noiseValue = pattern(screenUV * 3.0);
                vec3 noiseColor = mix(vec3(0.9), vec3(1.1), noiseValue * 0.2);
                vec3 emissive = baseColor * 2.0;
                vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
                float NdotL = max(dot(normalize(vNormal), lightDir), 0.0);
                float lighting = 0.5 + 0.5 * NdotL;
                vec3 lit = baseColor * noiseColor * lighting * 0.5;
                vec3 finalColor = emissive + lit;
                float pulse = 0.8 + 0.2 * sin(time * 3.0);
                finalColor *= pulse * 1.2;
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;

        // ============================================================
        // ASCII SHADER
        // ============================================================
        const AsciiShader = {
            uniforms: {
                'tDiffuse': { value: null },
                'tFont': { value: null },
                'resolution': { value: new THREE.Vector2() },
                'charSize': { value: 8.0 },
                'charCount': { value: 32.0 },
                'time': { value: 0 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform sampler2D tFont;
                uniform vec2 resolution;
                uniform float charSize;
                uniform float charCount;
                uniform float time;
                varying vec2 vUv;
            
                void main() {
                    vec2 cellSize = charSize / resolution;
                    vec2 cell = floor(vUv / cellSize);
                    vec2 cellCenter = (cell + 0.5) * cellSize;
                
                    vec4 texel = texture2D(tDiffuse, cellCenter);
                    float brightness = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
                
                    if (brightness < 0.08) {
                        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
                        return;
                    }
                
                    brightness = pow(brightness, 0.9);
                    float charIndex = floor(brightness * (charCount - 1.0));
                    vec2 cellUV = fract(vUv / cellSize);
                
                    float gridSize = 16.0;
                    float charX = mod(charIndex, gridSize);
                    float charY = floor(charIndex / gridSize);
                
                    vec2 fontUV = vec2(
                        (charX + cellUV.x) / gridSize,
                        1.0 - (charY + 1.0 - cellUV.y) / gridSize
                    );
                
                    float ascii = texture2D(tFont, fontUV).r;
                
                    vec3 asciiColor = vec3(1.0, 1.0, 1.0);
                    vec3 color = asciiColor * brightness * ascii * 1.2;
                
                    float alpha = ascii * brightness * 1.5;
                    gl_FragColor = vec4(color, alpha);
                }
            `
        };

        // ============================================================
        // FONT TEXTURE
        // ============================================================
        function createFontTexture() {
            const canvas = document.createElement('canvas');
            const size = 1024;
            const gridSize = 16;
            const cellSize = size / gridSize;
        
            canvas.width = size;
            canvas.height = size;
        
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, size, size);
        
            const chars = ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
        
            ctx.font = `${cellSize * 0.8}px monospace`;
            ctx.fillStyle = '#fff';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';
        
            for (let i = 0; i < chars.length && i < gridSize * gridSize; i++) {
                const x = (i % gridSize) * cellSize + cellSize / 2;
                const y = Math.floor(i / gridSize) * cellSize + cellSize / 2;
                ctx.fillText(chars[i], x, y);
            }
        
            const texture = new THREE.CanvasTexture(canvas);
            texture.minFilter = THREE.NearestFilter;
            texture.magFilter = THREE.NearestFilter;
        
            return { texture, charCount: chars.length };
        }

        // ============================================================
        // INIT ROBOT
        // ============================================================
        function initRobot() {
            const container = document.getElementById('robotContainer');
            if (!container) {
                log.error('[Robot]', 'Container not found!');
                return;
            }

            

            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(45, container.offsetWidth / container.offsetHeight, 0.1, 100);

            const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setSize(container.offsetWidth, container.offsetHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.setClearColor(0x000000, 0);
            container.appendChild(renderer.domElement);

            // Post processing
            const composer = new THREE.EffectComposer(renderer);
            composer.addPass(new THREE.RenderPass(scene, camera));
        
            // Glitch Shader
            const GlitchShader = {
                uniforms: {
                    'tDiffuse': { value: null },
                    'time': { value: 0 },
                    'glitchIntensity': { value: 0 },
                    'resolution': { value: new THREE.Vector2() }
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform sampler2D tDiffuse;
                    uniform float time;
                    uniform float glitchIntensity;
                    uniform vec2 resolution;
                    varying vec2 vUv;
                
                    float random(vec2 st) {
                        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
                    }
                
                    void main() {
                        vec2 uv = vUv;
                    
                        if (glitchIntensity > 0.0) {
                            // Horizontal shift glitch
                            float shift = glitchIntensity * 0.1 * sin(time * 100.0 + uv.y * 50.0);
                        
                            // Random block glitch
                            float blockY = floor(uv.y * 20.0);
                            float blockRandom = random(vec2(blockY, floor(time * 20.0)));
                            if (blockRandom > 0.7) {
                                shift += (blockRandom - 0.7) * 0.3 * glitchIntensity;
                            }
                        
                            uv.x += shift;
                        
                            // Scanline noise
                            float scanline = sin(uv.y * resolution.y * 2.0) * 0.02 * glitchIntensity;
                            uv.x += scanline;
                        }
                    
                        // RGB Split
                        float rgbShift = glitchIntensity * 0.02;
                        vec4 cr = texture2D(tDiffuse, vec2(uv.x + rgbShift, uv.y));
                        vec4 cg = texture2D(tDiffuse, uv);
                        vec4 cb = texture2D(tDiffuse, vec2(uv.x - rgbShift, uv.y));
                    
                        vec4 color = vec4(cr.r, cg.g, cb.b, cg.a);
                    
                        // Random noise overlay during glitch
                        if (glitchIntensity > 0.0) {
                            float noise = random(uv + time) * glitchIntensity * 0.15;
                            color.rgb += noise;
                        }
                    
                        gl_FragColor = color;
                    }
                `
            };
        
            const glitchPass = new THREE.ShaderPass(GlitchShader);
            glitchPass.uniforms['resolution'].value.set(container.offsetWidth, container.offsetHeight);
        
            const { texture: fontTexture, charCount } = createFontTexture();
            const asciiPass = new THREE.ShaderPass(AsciiShader);
            asciiPass.uniforms['tFont'].value = fontTexture;
            asciiPass.uniforms['resolution'].value.set(container.offsetWidth, container.offsetHeight);
            asciiPass.uniforms['charCount'].value = charCount;
            asciiPass.uniforms['charSize'].value = 8.0;
        
            // Start with ASCII enabled
            composer.addPass(asciiPass);
            composer.addPass(glitchPass);
        
            // === GLITCH TRANSITION SYSTEM ===
            let isAsciiMode = true;
            let glitchIntensity = 0;
            let transitionPhase = 'idle'; // 'idle', 'glitch-in', 'real', 'glitch-out'
            let transitionTimer = 0;
        
            const CYCLE_DURATION = 30;     // Seconds in ASCII mode
            const GLITCH_DURATION = 0.15;  // Glitch effect duration
            const REAL_DURATION = 0.4;     // Real robot visible duration
        
            // Хранилище материалов
            const originalMaterials = new Map();
            const asciiMaterials = new Map();
        
            function updateTransition(deltaTime) {
                transitionTimer += deltaTime;
            
                switch (transitionPhase) {
                    case 'idle':
                        // ASCII mode, waiting
                        if (transitionTimer >= CYCLE_DURATION) {
                            transitionPhase = 'glitch-in';
                            transitionTimer = 0;
                        }
                        break;
                    
                    case 'glitch-in':
                        // Glitch before showing real robot
                        glitchIntensity = Math.sin(transitionTimer / GLITCH_DURATION * Math.PI) * 1.5;
                    
                        if (transitionTimer >= GLITCH_DURATION * 0.5 && isAsciiMode) {
                            // Switch to real robot mid-glitch
                            isAsciiMode = false;
                            switchMaterials(false);
                            rebuildComposer();
                        }
                    
                        if (transitionTimer >= GLITCH_DURATION) {
                            transitionPhase = 'real';
                            transitionTimer = 0;
                            glitchIntensity = 0;
                        }
                        break;
                    
                    case 'real':
                        // Real robot visible
                        // Subtle glitch flickers
                        glitchIntensity = Math.random() > 0.85 ? 0.4 : 0;
                    
                        if (transitionTimer >= REAL_DURATION) {
                            transitionPhase = 'glitch-out';
                            transitionTimer = 0;
                        }
                        break;
                    
                    case 'glitch-out':
                        // Glitch before returning to ASCII
                        glitchIntensity = Math.sin(transitionTimer / GLITCH_DURATION * Math.PI) * 1.5;
                    
                        if (transitionTimer >= GLITCH_DURATION * 0.5 && !isAsciiMode) {
                            // Switch back to ASCII mid-glitch
                            isAsciiMode = true;
                            switchMaterials(true);
                            rebuildComposer();
                        }
                    
                        if (transitionTimer >= GLITCH_DURATION) {
                            transitionPhase = 'idle';
                            transitionTimer = 0;
                            glitchIntensity = 0;
                        }
                        break;
                }
            
                glitchPass.uniforms['glitchIntensity'].value = glitchIntensity;
            }
        
            function switchMaterials(toAscii) {
                if (!model) return;
            
                model.traverse((child) => {
                    if (child.isMesh && !child.name.toLowerCase().includes('mask')) {
                        if (toAscii) {
                            // Переключаем на ASCII материалы (noise shader)
                            if (asciiMaterials.has(child.uuid)) {
                                child.material = asciiMaterials.get(child.uuid);
                            }
                        } else {
                            // Переключаем на оригинальные материалы
                            if (originalMaterials.has(child.uuid)) {
                                child.material = originalMaterials.get(child.uuid);
                            }
                        }
                    }
                });
            }
        
            function rebuildComposer() {
                // Remove all passes
                while(composer.passes.length > 0) {
                    composer.passes.pop();
                }
            
                // Add render pass
                composer.addPass(new THREE.RenderPass(scene, camera));
            
                // Add ASCII pass only if in ASCII mode
                if (isAsciiMode) {
                    composer.addPass(asciiPass);
                }
            
                // Always add glitch pass last
                composer.addPass(glitchPass);
            }
        
            // Lighting
            scene.add(new THREE.AmbientLight(0xffffff, 0.8));
            const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
            dirLight.position.set(5, 5, 5);
            scene.add(dirLight);
            const backLight = new THREE.DirectionalLight(0xffffff, 0.5);
            backLight.position.set(-3, 0, -5);
            scene.add(backLight);
        
            // Mouse tracking
            let mouseX = 0, mouseY = 0, targetX = 0, targetY = 0;
            const windowHalfX = window.innerWidth / 2;
            const windowHalfY = window.innerHeight / 2;
        
            document.addEventListener('mousemove', (e) => {
                mouseX = (e.clientX - windowHalfX);
                mouseY = (e.clientY - windowHalfY);
            });
        
            // Load model
            let model = null, headBone = null;
            const noiseMaterials = [];

            // Setup GLTFLoader (without Draco - using original uncompressed model)
            const loader = new THREE.GLTFLoader();
        
            function createNoiseMaterial(baseColor, isEmissive = false) {
                const material = new THREE.ShaderMaterial({
                    vertexShader: NoiseVertexShader,
                    fragmentShader: isEmissive ? NoiseFragmentShaderEmissive : NoiseFragmentShader,
                    uniforms: {
                        time: { value: 0 },
                        resolution: { value: new THREE.Vector2(container.offsetWidth, container.offsetHeight) },
                        baseColor: { value: new THREE.Vector3(baseColor[0], baseColor[1], baseColor[2]) }
                    }
                });
                noiseMaterials.push(material);
                return material;
            }
        
            // Lazy load robot model for better initial page load performance
            function loadRobotModel() {
                

                // Show loading state
                showRobotLoading();

                loader.load('model/robot.glb', (gltf) => {
                    model = gltf.scene;
                    model.rotation.y = Math.PI * 1.5;

                    let meshCount = 0;
                    model.traverse((child) => {
                        if (child.isBone && (child.name.toLowerCase() === 'bone' || child.name.toLowerCase().includes('head'))) {
                            headBone = child;
                        }

                        if (child.isMesh) {
                            meshCount++;
                            const name = child.name.toLowerCase();
                            if (name.includes('mask')) {
                                child.visible = false;
                                return;
                            }

                            // Сохраняем оригинальный материал
                            originalMaterials.set(child.uuid, child.material.clone());

                            // Создаём ASCII материал (noise shader)
                            let asciiMat;
                            if (name.includes('light') || name.includes('visor')) {
                                asciiMat = createNoiseMaterial([0.2, 1.0, 0.3], true);
                            } else {
                                asciiMat = createNoiseMaterial([0.98, 0.98, 0.98], false);
                            }
                            asciiMaterials.set(child.uuid, asciiMat);

                            // Начинаем с ASCII материала
                            child.material = asciiMat;
                        }
                    });

                    const box = new THREE.Box3().setFromObject(model);
                    const center = box.getCenter(new THREE.Vector3());
                    const size = box.getSize(new THREE.Vector3());

                    model.position.x = -center.x;
                    model.position.y = -center.y - size.y * 0.05;
                    model.position.z = -center.z;

                    camera.position.z = size.y * 0.25;  // было 0.3, ближе = крупнее
                    camera.position.y = 0.5;
                    camera.lookAt(new THREE.Vector3(0, size.y * 0.35, 0));

                    scene.add(model);

                    log.info('[Robot]', 'Model loaded successfully, meshes:', meshCount);

                    if (headBone) {
                        headBone.userData.baseRotationY = headBone.rotation.y;
                        headBone.userData.baseRotationZ = headBone.rotation.z;
                    }

                    // Hide loading state
                    hideRobotLoading();

                    // Start animation AFTER model is loaded and added to scene
                    animate();
                }, undefined, (error) => {
                    log.error('[Robot]', 'Error loading model:', error);

                    // Hide loading, show error
                    hideRobotLoading();
                    showRobotError();

                    // Show toast notification
                    notify.error('Failed to load 3D robot model. Check your connection.');
                });
            }

            // Retry button handler
            const retryBtn = document.getElementById('retryRobotLoad');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => {
                    hideRobotError();
                    loadRobotModel();
                });
            }

            // Delay robot model loading to prioritize critical page content
            // Load after 1 second or when hero section is visible (whichever comes first)
            let modelLoaded = false;

            const heroObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && !modelLoaded) {
                        modelLoaded = true;
                        loadRobotModel();
                        heroObserver.disconnect();
                    }
                });
            }, { threshold: 0.1 });

            const heroSection = document.getElementById('heroSection');
            if (heroSection) {
                heroObserver.observe(heroSection);
            }

            // Fallback: load after 1.5 seconds even if hero not in view
            setTimeout(() => {
                if (!modelLoaded) {
                    modelLoaded = true;
                    loadRobotModel();
                }
            }, 1500);

            // Animation function (will be called after model loads)
            const clock = new THREE.Clock();
            let lastTime = 0;

            function animate() {
                requestAnimationFrame(animate);

                const time = clock.getElapsedTime();
                const deltaTime = time - lastTime;
                lastTime = time;

                // Update glitch transition
                updateTransition(deltaTime);

                targetX = mouseX * 0.0003;
                targetY = mouseY * 0.00025;

                if (headBone) {
                    const lerpFactor = 0.06;
                    const maxRotationY = 0.25;
                    const maxRotationX = 0.2;

                    const baseY = headBone.userData.baseRotationY || 0;
                    const baseZ = headBone.userData.baseRotationZ || 0;

                    const offsetY = Math.max(-maxRotationY, Math.min(maxRotationY, targetX * 3));
                    const offsetZ = Math.max(-maxRotationX, Math.min(maxRotationX, -targetY * 3));

                    headBone.rotation.y += (baseY + offsetY - headBone.rotation.y) * lerpFactor;
                    headBone.rotation.z += (baseZ + offsetZ - headBone.rotation.z) * lerpFactor;
                }

                noiseMaterials.forEach(mat => mat.uniforms.time.value = time);
                asciiPass.uniforms['time'].value = time;
                glitchPass.uniforms['time'].value = time;
                glitchPass.uniforms['glitchIntensity'].value = glitchIntensity;

                composer.render();
            }

            // Resize handler (debounced for performance)
            const handleResize = window.debounce(() => {
                const width = container.offsetWidth;
                const height = container.offsetHeight;

                camera.aspect = width / height;
                camera.updateProjectionMatrix();
                renderer.setSize(width, height);
                composer.setSize(width, height);
                asciiPass.uniforms['resolution'].value.set(width, height);
                glitchPass.uniforms['resolution'].value.set(width, height);

                noiseMaterials.forEach(mat => mat.uniforms.resolution.value.set(width, height));
            }, 200);

            window.addEventListener('resize', handleResize);
        }
    
        // Initialize when DOM ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initRobot);
        } else {
            initRobot();
        }

    // ============================================================
    // ASCII ASSEMBLY EFFECT - Robot assembles from chaos
    // ============================================================
    
        const canvas = document.getElementById('assemblyCanvas');
        if (!canvas) return;
    
        const ctx = canvas.getContext('2d');
        const chars = ".`'^\":;Il!i><~+_-?][}{1)(|/\\tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
    
        let particles = [];
        let assemblyComplete = false;
        let animationStartTime = null;
        const ASSEMBLY_DURATION = 3000; // 3 seconds to assemble
        const PARTICLE_COUNT = 800;
    
        // Robot silhouette target points (normalized 0-1)
        const robotShape = [];
    
        function generateRobotShape() {
            // Head (oval)
            for (let i = 0; i < 60; i++) {
                const angle = (i / 60) * Math.PI * 2;
                const rx = 0.08 + Math.random() * 0.02;
                const ry = 0.1 + Math.random() * 0.02;
                robotShape.push({
                    x: 0.5 + Math.cos(angle) * rx,
                    y: 0.18 + Math.sin(angle) * ry
                });
            }
        
            // Neck
            for (let i = 0; i < 15; i++) {
                robotShape.push({
                    x: 0.48 + Math.random() * 0.04,
                    y: 0.28 + Math.random() * 0.04
                });
            }
        
            // Shoulders
            for (let i = 0; i < 40; i++) {
                robotShape.push({
                    x: 0.32 + Math.random() * 0.36,
                    y: 0.32 + Math.random() * 0.03
                });
            }
        
            // Torso (trapezoid)
            for (let i = 0; i < 100; i++) {
                const y = 0.35 + Math.random() * 0.25;
                const widthAtY = 0.15 - (y - 0.35) * 0.1;
                robotShape.push({
                    x: 0.5 + (Math.random() - 0.5) * widthAtY * 2,
                    y: y
                });
            }
        
            // Arms
            for (let side = -1; side <= 1; side += 2) {
                for (let i = 0; i < 50; i++) {
                    const armY = 0.34 + Math.random() * 0.28;
                    robotShape.push({
                        x: 0.5 + side * (0.18 + Math.random() * 0.04),
                        y: armY
                    });
                }
            }
        
            // Hips
            for (let i = 0; i < 30; i++) {
                robotShape.push({
                    x: 0.42 + Math.random() * 0.16,
                    y: 0.60 + Math.random() * 0.04
                });
            }
        
            // Legs
            for (let side = -1; side <= 1; side += 2) {
                for (let i = 0; i < 80; i++) {
                    const legY = 0.64 + Math.random() * 0.32;
                    robotShape.push({
                        x: 0.5 + side * (0.06 + Math.random() * 0.03),
                        y: legY
                    });
                }
            }
        
            // Eyes (glowing points)
            for (let side = -1; side <= 1; side += 2) {
                for (let i = 0; i < 10; i++) {
                    robotShape.push({
                        x: 0.5 + side * 0.03 + (Math.random() - 0.5) * 0.015,
                        y: 0.16 + (Math.random() - 0.5) * 0.015,
                        isEye: true
                    });
                }
            }
        }
    
        function resize() {
            canvas.width = canvas.offsetWidth * window.devicePixelRatio;
            canvas.height = canvas.offsetHeight * window.devicePixelRatio;
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        }
    
        function createParticles() {
            particles = [];
            generateRobotShape();
        
            const w = canvas.offsetWidth;
            const h = canvas.offsetHeight;
        
            for (let i = 0; i < PARTICLE_COUNT; i++) {
                const targetPoint = robotShape[i % robotShape.length];
            
                // Start from random position (chaos)
                const startAngle = Math.random() * Math.PI * 2;
                const startDist = Math.max(w, h) * (0.5 + Math.random() * 0.5);
            
                particles.push({
                    // Current position (starts in chaos)
                    x: w / 2 + Math.cos(startAngle) * startDist,
                    y: h / 2 + Math.sin(startAngle) * startDist,
                    // Target position (robot shape)
                    targetX: targetPoint.x * w,
                    targetY: targetPoint.y * h,
                    // Properties
                    char: chars[Math.floor(Math.random() * chars.length)],
                    size: 8 + Math.random() * 6,
                    opacity: 0.3 + Math.random() * 0.7,
                    isEye: targetPoint.isEye || false,
                    // Animation
                    delay: Math.random() * 0.3, // Stagger start
                    speed: 0.8 + Math.random() * 0.4
                });
            }
        }
    
        function easeOutCubic(t) {
            return 1 - Math.pow(1 - t, 3);
        }
    
        function animate(timestamp) {
            if (!animationStartTime) animationStartTime = timestamp;
            const elapsed = timestamp - animationStartTime;
            const progress = Math.min(elapsed / ASSEMBLY_DURATION, 1);
        
            ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
        
            // Set font
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
        
            particles.forEach(p => {
                // Calculate individual progress with delay
                let individualProgress = (progress - p.delay) / (1 - p.delay);
                individualProgress = Math.max(0, Math.min(1, individualProgress));
                individualProgress = easeOutCubic(individualProgress) * p.speed;
                individualProgress = Math.min(1, individualProgress);
            
                // Interpolate position
                const x = p.x + (p.targetX - p.x) * individualProgress;
                const y = p.y + (p.targetY - p.y) * individualProgress;
            
                // Color - green for eyes, white/gray for body
                if (p.isEye) {
                    ctx.fillStyle = `rgba(16, 185, 129, ${p.opacity})`;
                } else {
                    const brightness = 0.4 + individualProgress * 0.4;
                    ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity * brightness})`;
                }
            
                // Add some chaos/jitter before fully assembled
                const jitter = (1 - individualProgress) * 5;
                const jx = x + (Math.random() - 0.5) * jitter;
                const jy = y + (Math.random() - 0.5) * jitter;
            
                ctx.fillText(p.char, jx, jy);
            });
        
            // Continue animation or fade out
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else if (!assemblyComplete) {
                assemblyComplete = true;
                // Fade out the assembly canvas
                fadeOutAssembly();
            }
        }
    
        function fadeOutAssembly() {
            let opacity = 1;
            const fadeInterval = setInterval(() => {
                opacity -= 0.05;
                canvas.style.opacity = opacity;
            
                if (opacity <= 0) {
                    clearInterval(fadeInterval);
                    canvas.style.display = 'none';
                }
            }, 50);
        }
    
        function init() {
            resize();
            createParticles();
            requestAnimationFrame(animate);
        }
    
        // Debounced resize handler
        window.addEventListener('resize', window.debounce(() => {
            if (!assemblyComplete) {
                resize();
                createParticles();
            }
        }, 200));
    
        // Start when DOM ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
}