import { Buffer } from 'buffer'
window.Buffer = Buffer

import { onCLS, onINP, onLCP, onFCP, onTTFB } from 'https://unpkg.com/web-vitals@3/dist/web-vitals.js?module';
import { initWaitlist } from './waitlist.js';
import { initLanguageToggle } from './i18n.js';
import { initWallet } from './wallet.js';
import { initMarketplace } from './marketplace.js';
import { initScrollAnimations, initGSAPAnimations, initCustomCursor, initParallax, initAsciiRobot } from './animations.js';
import notify from './ui/notify.js';
import { log } from './utils/logger.js';

// ============ Global Error Handlers ============
// Catch unhandled promise rejections
window.addEventListener('unhandledrejection', (e) => {
    console.error('[Unhandled Rejection]', e.reason);
    const message = e.reason?.message || 'Unexpected error occurred';
    notify.error(message);
    // Prevent default browser error logging
    e.preventDefault();
});

// Catch uncaught errors
window.addEventListener('error', (e) => {
    console.error('[Uncaught Error]', e.error || e.message);
    notify.error('Unexpected error occurred');
});

// Network status handlers
window.addEventListener('offline', () => {
    notify.error('You are offline. Some features may not work.');
});

window.addEventListener('online', () => {
    notify.success('Back online!');
});

// Note: Console logging is now managed by scripts/utils/logger.js
// In dev: all log levels active
// In prod: only warn/error active

const structuredData = [
    `{
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "name": "Roborio",
        "alternateName": "$ROBORIO",
        "description": "Roborio is the first decentralized marketplace for robot rentals on Solana blockchain. Rent delivery, cleaning, security robots per-task, per-minute, or per-km.",
        "url": "https://www.roborio.xyz",
        "applicationCategory": "Marketplace",
        "operatingSystem": "Web",
        "offers": {
            "@type": "Offer",
            "category": "Robot Rental Services",
            "priceCurrency": "SOL",
            "availability": "https://schema.org/PreOrder"
        },
        "provider": {
            "@type": "Organization",
            "name": "Roborio",
            "url": "https://www.roborio.xyz"
        },
        "featureList": [
            "Delivery robots rental",
            "Cleaning robots rental",
            "Security robots rental",
            "Pay per-task pricing",
            "Pay per-minute pricing",
            "Pay per-kilometer pricing",
            "Solana blockchain integration",
            "$ROBORIO token payments"
        ],
        "softwareVersion": "2.0",
        "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": "5.0",
            "ratingCount": "1",
            "bestRating": "5",
            "worstRating": "1"
        }
    }`,
    `{
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "Roborio",
        "alternateName": "$ROBORIO",
        "url": "https://www.roborio.xyz",
        "logo": "https://www.roborio.xyz/logo.png",
        "description": "Decentralized Robot-as-a-Service marketplace on Solana blockchain",
        "slogan": "Rent robots on-demand. Pay per-task, per-minute, or per-km.",
        "foundingDate": "2025",
        "industry": "Robotics, Blockchain, Web3",
        "knowsAbout": [
            "Robotics",
            "Robot Rental",
            "Blockchain Technology",
            "Solana",
            "Decentralized Marketplace",
            "Smart Contracts",
            "RaaS (Robot-as-a-Service)",
            "Cryptocurrency"
        ],
        "sameAs": [

        ]
    }`,
    `{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": "What is Roborio?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Roborio is a decentralized marketplace built on Solana where businesses can rent robots on-demand. Think of it as Uber for robots — operators list their robots, businesses rent them for specific tasks, and payments are handled automatically via smart contracts."
                }
            },
            {
                "@type": "Question",
                "name": "How do payments work?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "For MVP pilots, payments are coordinated directly with verified operators after you reserve a slot. Escrow automation is planned for later phases as we expand the marketplace."
                }
            },
            {
                "@type": "Question",
                "name": "What types of robots are available?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Our marketplace features delivery robots, cleaning bots, security patrol units, inspection drones, warehouse automation, agricultural robots, and healthcare assistants. New categories are added as operators join the platform."
                }
            },
            {
                "@type": "Question",
                "name": "How do I become a robot operator?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Robot owners can list their units on Roborio, set their own pricing, and earn $ROBORIO for completed tasks. Our platform handles booking, payments, and dispute resolution. Staking $ROBORIO tokens gives operators priority listing."
                }
            },
            {
                "@type": "Question",
                "name": "What is $ROBORIO token used for?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "$ROBORIO will power discounts, staking, and governance once the token is live. The MVP demo focuses on marketplace flow and operator trust while token utilities roll out."
                }
            },
            {
                "@type": "Question",
                "name": "When will the marketplace launch?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "The MVP demo is live today, and we’re onboarding pilot customers now. Join the waitlist to secure early access and priority reservations."
                }
            },
            {
                "@type": "Question",
                "name": "How does Roborio ensure quality?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Every operator is vetted and each robot is reviewed before it appears in the demo. We also collect post-pilot feedback to keep only top-performing operators."
                }
            },
            {
                "@type": "Question",
                "name": "Is there an API for businesses?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Yes, our REST API allows businesses to integrate robot rentals directly into their operations. Schedule recurring tasks, manage fleets, track robots in real-time, and automate payments — all programmatically."
                }
            }
        ]
    }`
];

function injectStructuredData() {
    structuredData.forEach((json) => {
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.textContent = json;
        document.head.appendChild(script);
    });
}

function initWebVitals() {
    function logWebVital(metric) {
        const { name, value, rating } = metric;

        log.debug('[Web Vitals]', `${name}:`, {
            value: value.toFixed(2),
            rating: rating,
            unit: name === 'CLS' ? 'score' : 'ms'
        });

        window.webVitals = window.webVitals || {};
        window.webVitals[name] = {
            value: value.toFixed(2),
            rating: rating,
            timestamp: Date.now()
        };
    }

    onCLS(logWebVital);
    onINP(logWebVital);
    onLCP(logWebVital);
    onFCP(logWebVital);
    onTTFB(logWebVital);
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
            if (existing.dataset.loaded === 'true') {
                resolve();
            } else {
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
            }
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.addEventListener('load', () => {
            script.dataset.loaded = 'true';
            resolve();
        });
        script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
        document.head.appendChild(script);
    });
}

async function loadExternalScripts() {
    const scripts = [
        'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
        'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
        'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/EffectComposer.js',
        'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/RenderPass.js',
        'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/ShaderPass.js',
        'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/CopyShader.js',
        'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js',
        'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js',
        'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
        'https://unpkg.com/@solana/web3.js@latest/lib/index.iife.min.js'
        
    ];

    for (const src of scripts) {
        await loadScript(src);
    }
}



'use strict';

    // ============ Performance Utilities  ============
    /**
     * Throttle function - limits execution to once per specified delay
     * Perfect for scroll and resize events
     */
    window.throttle = function throttle(func, delay = 100) {
        let timeoutId = null;
        let lastExecTime = 0;

        return function(...args) {
            const currentTime = Date.now();
            const timeSinceLastExec = currentTime - lastExecTime;

            const execute = () => {
                lastExecTime = currentTime;
                func.apply(this, args);
            };

            if (timeSinceLastExec >= delay) {
                execute();
            } else {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(execute, delay - timeSinceLastExec);
            }
        };
    };

    /**
     * Debounce function - delays execution until after specified delay
     * Perfect for resize events and input handlers
     */
    window.debounce = function debounce(func, delay = 250) {
        let timeoutId = null;

        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                func.apply(this, args);
            }, delay);
        };
    };

    /**
     * RequestAnimationFrame throttle - optimal for scroll events
     */
    window.rafThrottle = function rafThrottle(func) {
        let rafId = null;
        let running = false;

        return function(...args) {
            if (running) return;

            running = true;
            rafId = requestAnimationFrame(() => {
                func.apply(this, args);
                running = false;
            });
        };
    };

    // Create local references for convenience
    const throttle = window.throttle;
    const debounce = window.debounce;
    const rafThrottle = window.rafThrottle;

    // ============ Error Handling & Loading States ============
    /**
     * Show toast notification
     * @param {string} message - Message to display
     * @param {string} type - 'error' or 'success'
     * @param {number} duration - Duration in ms (default 5000)
     */
    window.showToast = function showToast(message, type = 'error', duration = 5000) {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const messageSpan = document.createElement('span');
        messageSpan.className = 'toast-message';
        messageSpan.textContent = message;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.textContent = '×';
        closeBtn.setAttribute('aria-label', 'Close notification');
        closeBtn.onclick = () => toast.remove();

        toast.appendChild(messageSpan);
        toast.appendChild(closeBtn);
        container.appendChild(toast);

        // Auto-remove after duration
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.animation = 'slideInRight 0.3s ease-out reverse';
                setTimeout(() => toast.remove(), 300);
            }
        }, duration);
    };

    /**
     * Robot model loading/error states
     */
    window.showRobotLoading = function showRobotLoading() {
        const loading = document.getElementById('robotLoading');
        const error = document.getElementById('robotError');
        if (loading) loading.style.display = 'block';
        if (error) error.style.display = 'none';
    };

    window.hideRobotLoading = function hideRobotLoading() {
        const loading = document.getElementById('robotLoading');
        if (loading) loading.style.display = 'none';
    };

    window.showRobotError = function showRobotError() {
        const loading = document.getElementById('robotLoading');
        const error = document.getElementById('robotError');
        if (loading) loading.style.display = 'none';
        if (error) error.style.display = 'block';
    };

    window.hideRobotError = function hideRobotError() {
        const error = document.getElementById('robotError');
        if (error) error.style.display = 'none';
    };

    // Create local references for convenience
    const showToast = window.showToast;
    const showRobotLoading = window.showRobotLoading;
    const hideRobotLoading = window.hideRobotLoading;
    const showRobotError = window.showRobotError;
    const hideRobotError = window.hideRobotError;

    // ============ Mobile Menu ============
    function initMobileMenu() {
        try {
            const toggle = document.getElementById('mobileMenuToggle');
            const menu = document.getElementById('mobileMenu');
            const overlay = document.getElementById('mobileMenuOverlay');
            const closeBtn = document.getElementById('mobileMenuClose');
            const menuLinks = menu?.querySelectorAll('a');

            if (!toggle || !menu || !overlay) return;

            function openMenu() {
                menu.classList.add('active');
                overlay.classList.add('active');
                toggle.setAttribute('aria-expanded', 'true');
                toggle.style.display = 'none';
                document.body.classList.add('menu-open');
                closeBtn?.focus();
            }

            function closeMenu() {
                menu.classList.remove('active');
                overlay.classList.remove('active');
                toggle.setAttribute('aria-expanded', 'false');
                toggle.style.display = '';
                document.body.classList.remove('menu-open');
                toggle.focus();
            }

            toggle.addEventListener('click', openMenu);
            closeBtn?.addEventListener('click', closeMenu);
            overlay.addEventListener('click', closeMenu);

            // Close on escape key
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && menu.classList.contains('active')) {
                    closeMenu();
                }
            });

            // Close menu when clicking links
            menuLinks?.forEach(link => {
                link.addEventListener('click', () => {
                    closeMenu();
                });
            });

        } catch (e) {
            log.error('[Mobile Menu]', 'Init failed:', e);
        }
    }

    // ============ Seamless Infinite Marquee ============
    function initMarquee() {
        try {
            const marquee = document.querySelector('.partners-marquee');
            const track = document.querySelector('.partners-track');
            const originalSet = document.querySelector('.partners-set');
            
            if (!track || !marquee || !originalSet) return;
            
            // Measure width of one set (includes padding-right)
            const setWidth = originalSet.offsetWidth;
            
            // Clone the set multiple times to ensure seamless loop
            for (let i = 0; i < 3; i++) {
                const clone = originalSet.cloneNode(true);
                track.appendChild(clone);
            }
            
            let position = 0;
            const speed = 0.42;
            let isPaused = false;
            let animationId = null;
            
            function animate() {
                if (!isPaused) {
                    position -= speed;
                    
                    // Reset when one full set has scrolled
                    if (Math.abs(position) >= setWidth) {
                        position = 0;
                    }
                    
                    track.style.transform = `translateX(${position}px)`;
                }
                animationId = requestAnimationFrame(animate);
            }
            
            // Pause on hover
            marquee.addEventListener('mouseenter', () => isPaused = true);
            marquee.addEventListener('mouseleave', () => isPaused = false);
            
            // Pause when tab is hidden
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    isPaused = true;
                } else {
                    isPaused = false;
                }
            });
            
            animate();

        } catch (e) {
            log.error('[Marquee]', 'Init failed:', e);
        }
    }

    // ============ FAQ Toggle with Accessibility ============
    function initFAQ() {
        try {
            const faqQuestions = document.querySelectorAll('.faq-question');

            faqQuestions.forEach((question, index) => {
                const item = question.parentElement;
                const answer = item.querySelector('.faq-answer');
                const answerId = `faq-answer-${index}`;
                
                // Set ARIA attributes
                answer.id = answerId;
                question.setAttribute('aria-controls', answerId);
                question.setAttribute('aria-expanded', 'false');
                answer.setAttribute('role', 'region');
                answer.setAttribute('aria-hidden', 'true');

                function toggleFaq() {
                    const isActive = item.classList.contains('active');
                    
                    // Close all other FAQ items
                    document.querySelectorAll('.faq-item').forEach(faq => {
                        faq.classList.remove('active');
                        const q = faq.querySelector('.faq-question');
                        const a = faq.querySelector('.faq-answer');
                        q?.setAttribute('aria-expanded', 'false');
                        a?.setAttribute('aria-hidden', 'true');
                    });
                    
                    // Toggle current item
                    if (!isActive) {
                        item.classList.add('active');
                        question.setAttribute('aria-expanded', 'true');
                        answer.setAttribute('aria-hidden', 'false');
                    }
                }

                // Click handler
                question.addEventListener('click', toggleFaq);

                // Keyboard handler (Enter and Space)
                question.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleFaq();
                    }
                });
            });

        } catch (e) {
            log.error('[FAQ]', 'Init failed:', e);
        }
    }

    // ============ Usecases Infinite Carousel ============
    function initUsecasesScroll() {
        try {
            const container = document.getElementById('usecasesScroll');
            if (!container) return;

            const cards = Array.from(container.querySelectorAll('.usecase-card'));
            if (cards.length === 0) return;

            // NO CLONING - just use original cards (no infinite loop)
            // Container starts at scroll position 0 (beginning)

            let isDown = false;
            let startX = 0;
            let startScroll = 0;
            let velocity = 0;
            let lastX = 0;
            let lastTime = 0;
            let animFrameId = null;

            function animate() {
                if (Math.abs(velocity) > 0.5) {
                    container.scrollLeft -= velocity;
                    velocity *= 0.85;
                    // No checkPosition() - allow natural scroll boundaries
                    animFrameId = requestAnimationFrame(animate);
                } else {
                    velocity = 0;
                    cancelAnimationFrame(animFrameId);
                }
            }

            container.addEventListener('mousedown', (e) => {
                isDown = true;
                cancelAnimationFrame(animFrameId);
                velocity = 0;
                startX = e.clientX;
                startScroll = container.scrollLeft;
                lastX = e.clientX;
                lastTime = Date.now();
                container.classList.add('dragging');
            });

            container.addEventListener('mousemove', (e) => {
                if (!isDown) return;

                const now = Date.now();
                const elapsed = now - lastTime;

                container.scrollLeft = startScroll + (startX - e.clientX);

                if (elapsed > 0) {
                    velocity = (lastX - e.clientX) * (1000 / elapsed) * 0.08;
                }

                lastX = e.clientX;
                lastTime = now;
                // No checkPosition() - allow natural scroll boundaries
            });

            function endDrag() {
                if (!isDown) return;
                isDown = false;
                container.classList.remove('dragging');

                if (Math.abs(velocity) > 0.5) {
                    animate();
                }
            }

            container.addEventListener('mouseup', endDrag);
            container.addEventListener('mouseleave', endDrag);

            // Touch events
            let touchStartX = 0;
            let touchStartScroll = 0;

            container.addEventListener('touchstart', (e) => {
                isDown = true;
                cancelAnimationFrame(animFrameId);
                velocity = 0;
                touchStartX = e.touches[0].clientX;
                touchStartScroll = container.scrollLeft;
                lastX = e.touches[0].clientX;
                lastTime = Date.now();
            }, { passive: true });

            container.addEventListener('touchmove', (e) => {
                if (!isDown) return;

                const now = Date.now();
                const elapsed = now - lastTime;

                container.scrollLeft = touchStartScroll + (touchStartX - e.touches[0].clientX);

                if (elapsed > 0) {
                    velocity = (lastX - e.touches[0].clientX) * (1000 / elapsed) * 0.08;
                }

                lastX = e.touches[0].clientX;
                lastTime = now;
                // No checkPosition() - allow natural scroll boundaries
            }, { passive: true });

            container.addEventListener('touchend', () => {
                if (!isDown) return;
                isDown = false;

                if (Math.abs(velocity) > 0.5) {
                    animate();
                }
            });

        } catch (e) {
            log.error('[Usecases]', 'Scroll init failed:', e);
        }
    }

    // ============ Solana Text Hit Effect ============
    function initSolanaHit() {
        try {
            const solanaText = document.getElementById('solanaText');
            if (!solanaText) return;
            
            function triggerHit() {
                solanaText.classList.add('hit');
                setTimeout(() => {
                    solanaText.classList.remove('hit');
                }, 200);
            }
            
            // Trigger hit every 10 seconds
            setInterval(triggerHit, 10000);
            // First hit after 10 seconds
            setTimeout(triggerHit, 10000);

        } catch (e) {
            log.error('[Solana Hit]', 'Init failed:', e);
        }
    }

    // ============ Matrix Canvas Background ============
    function initMatrix() {
        try {
            const canvas = document.getElementById('matrixCanvas');
            const heroSection = document.getElementById('heroSection');
            
            if (!canvas || !heroSection) return;

            const ctx = canvas.getContext('2d');
            
            let matrixWidth, matrixHeight;
            let columns;
            let drops = [];
            let matrixAnimating = true;
            let lastFrameTime = 0;
            const TARGET_FPS = 30;
            const FRAME_INTERVAL = 1000 / TARGET_FPS;
            
            const FONT_SIZE = 14;
            const matrixChars = 'ROBORIO$01アイウエオカキクケコサシスセソ◆◇□■●○'.split('');
            
            function setupMatrix() {
                matrixWidth = heroSection.offsetWidth;
                matrixHeight = heroSection.offsetHeight;
                canvas.width = matrixWidth;
                canvas.height = matrixHeight;
                
                columns = Math.floor(matrixWidth / FONT_SIZE);
                drops = [];
                
                for (let i = 0; i < columns; i++) {
                    drops[i] = Math.random() * -100;
                }
            }
            
            function drawMatrix(timestamp) {
                if (!matrixAnimating) return;

                // Throttle to ~30fps
                if (timestamp - lastFrameTime < FRAME_INTERVAL) {
                    requestAnimationFrame(drawMatrix);
                    return;
                }
                lastFrameTime = timestamp;
                
                // Semi-transparent black to create trail effect
                ctx.fillStyle = 'rgba(5, 5, 5, 0.05)';
                ctx.fillRect(0, 0, matrixWidth, matrixHeight);
                
                ctx.fillStyle = '#10b981';
                ctx.font = FONT_SIZE + 'px monospace';
                
                for (let i = 0; i < drops.length; i++) {
                    // Random character
                    const char = matrixChars[Math.floor(Math.random() * matrixChars.length)];
                    
                    // Vary the opacity
                    const alpha = 0.3 + Math.random() * 0.7;
                    ctx.fillStyle = `rgba(16, 185, 129, ${alpha})`;
                    
                    // Draw character
                    ctx.fillText(char, i * FONT_SIZE, drops[i] * FONT_SIZE);
                    
                    // Bright head of the drop
                    if (Math.random() > 0.95) {
                        ctx.fillStyle = '#34d399';
                        ctx.fillText(char, i * FONT_SIZE, drops[i] * FONT_SIZE);
                    }
                    
                    // Reset drop randomly or when off screen
                    if (drops[i] * FONT_SIZE > matrixHeight && Math.random() > 0.975) {
                        drops[i] = 0;
                    }
                    
                    // Move drop down
                    drops[i] += 0.5 + Math.random() * 0.5;
                }
                
                requestAnimationFrame(drawMatrix);
            }
            
            // Intersection Observer - pause when not visible
            const matrixObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        if (!matrixAnimating) {
                            matrixAnimating = true;
                            requestAnimationFrame(drawMatrix);
                        }
                    } else {
                        matrixAnimating = false;
                    }
                });
            }, { threshold: 0.1 });
            
            matrixObserver.observe(heroSection);

            // Pause when tab is hidden (Visibility API)
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    matrixAnimating = false;
                } else if (heroSection.getBoundingClientRect().top < window.innerHeight) {
                    matrixAnimating = true;
                    requestAnimationFrame(drawMatrix);
                }
            });
            
            // Initialize and start
            setupMatrix();
            requestAnimationFrame(drawMatrix);

            // Resize handler with debounce (using utility function)
            window.addEventListener('resize', debounce(setupMatrix, 150));

        } catch (e) {
            log.error('[Matrix]', 'Canvas init failed:', e);
        }
    }

    // ============ Smooth Scroll for Anchor Links ============
    function initSmoothScroll() {
        try {
            document.querySelectorAll('a[href^="#"]').forEach(anchor => {
                anchor.addEventListener('click', function(e) {
                    const href = this.getAttribute('href');
                    if (href !== '#') {
                        e.preventDefault();
                        const target = document.querySelector(href);
                        if (target) {
                            target.scrollIntoView({
                                behavior: 'smooth'
                            });
                            // Update focus for accessibility
                            target.setAttribute('tabindex', '-1');
                            target.focus({ preventScroll: true });
                        }
                    }
                });
            });

        } catch (e) {
            log.error('[Smooth Scroll]', 'Init failed:', e);
        }
    }

    // ============ Preloader ============
    function initPreloader() {
        const preloader = document.getElementById('preloader');
        const terminalContent = document.getElementById('terminalContent');
        const progressBar = document.getElementById('preloaderProgress');
        const percentText = document.getElementById('preloaderPercent');
        const statusText = document.getElementById('preloaderStatus');
        
        if (!preloader || !terminalContent) return;

        const terminalLines = [
            { text: '> Initializing Roborio...', delay: 0, progress: 10, status: 'Initializing...' },
            { text: '> User: <span class="value">Guest</span>', delay: 300, progress: 20, status: 'Authenticating...' },
            { text: '> Password: <span class="value">********</span>', delay: 600, progress: 35, status: 'Verifying...' },
            { text: '> Connecting to Solana...', delay: 900, progress: 55, status: 'Connecting to blockchain...' },
            { text: '> Status: <span class="success">Connected</span>', delay: 1200, progress: 75, status: 'Blockchain connected!' },
            { text: '> Loading marketplace...', delay: 1500, progress: 90, status: 'Loading assets...' },
            { text: '> Access: <span class="success">Granted ✓</span>', delay: 1800, progress: 100, status: 'Ready!' },
        ];

        // Animate progress bar smoothly
        let currentProgress = 0;
        const animateProgress = (target) => {
            const step = () => {
                if (currentProgress < target) {
                    currentProgress += 1;
                    if (progressBar) progressBar.style.width = currentProgress + '%';
                    if (percentText) percentText.textContent = currentProgress + '%';
                    requestAnimationFrame(step);
                }
            };
            step();
        };

        // Safe HTML parsing function for terminal lines
        function parseLineWithSpans(text) {
            const fragment = document.createDocumentFragment();

            // Simple regex to find <span class="...">content</span>
            const spanRegex = /<span class="([^"]+)">([^<]+)<\/span>/g;
            let lastIndex = 0;
            let match;

            while ((match = spanRegex.exec(text)) !== null) {
                // Add text before span
                if (match.index > lastIndex) {
                    const textNode = document.createTextNode(text.slice(lastIndex, match.index));
                    fragment.appendChild(textNode);
                }

                // Create span element
                const span = document.createElement('span');
                span.className = match[1]; // class name
                span.textContent = match[2]; // content
                fragment.appendChild(span);

                lastIndex = spanRegex.lastIndex;
            }

            // Add remaining text
            if (lastIndex < text.length) {
                const textNode = document.createTextNode(text.slice(lastIndex));
                fragment.appendChild(textNode);
            }

            return fragment;
        }

        terminalLines.forEach((line, index) => {
            setTimeout(() => {
                const lineEl = document.createElement('div');
                lineEl.className = 'preloader-terminal-line';
                // Use safe parsing instead of innerHTML or textContent
                lineEl.appendChild(parseLineWithSpans(line.text));
                lineEl.style.animationDelay = '0s';
                terminalContent.appendChild(lineEl);
                
                // Update progress
                animateProgress(line.progress);
                if (statusText) statusText.textContent = line.status;
            }, line.delay);
        });

        // Hide preloader after animation completes
        const totalTime = terminalLines[terminalLines.length - 1].delay + 800;
        
        setTimeout(() => {
            preloader.classList.add('hidden');
        }, totalTime);

        // Fallback: hide after 4 seconds max
        setTimeout(() => {
            preloader.classList.add('hidden');
        }, 4000);
    }


    // ============ Scroll Progress Indicator ============
    function initScrollIndicator() {
        const indicator = document.getElementById('scrollIndicator');
        if (!indicator) return;
        
        function updateProgress() {
            const scrollTop = window.scrollY;
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            const progress = (scrollTop / docHeight) * 100;
            indicator.style.width = progress + '%';
        }
        
        window.addEventListener('scroll', updateProgress, { passive: true });
        updateProgress();
    }

    // ============ Back to Top Button ============
    function initBackToTop() {
        const btn = document.getElementById('backToTop');
        if (!btn) return;

        // Show/hide based on scroll position (throttled for performance)
        const handleScroll = rafThrottle(() => {
            if (window.scrollY > 500) {
                btn.classList.add('visible');
            } else {
                btn.classList.remove('visible');
            }
        });

        window.addEventListener('scroll', handleScroll, { passive: true });

        // Scroll to top on click
        btn.addEventListener('click', () => {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    }

    // ============ Cookie Banner ============
    function initCookieBanner() {
        const banner = document.getElementById('cookieBanner');
        const acceptBtn = document.getElementById('cookieAccept');
        const declineBtn = document.getElementById('cookieDecline');
        
        if (!banner) return;

        // Check if user already made a choice
        const cookieChoice = localStorage.getItem('cookieConsent');
        
        if (!cookieChoice) {
            // Show banner after 2 seconds
            setTimeout(() => {
                banner.classList.add('visible');
            }, 2000);
        }

        // Accept cookies
        acceptBtn?.addEventListener('click', () => {
            localStorage.setItem('cookieConsent', 'accepted');
            banner.classList.remove('visible');
            // Initialize analytics after consent
            initAnalytics();
        });

        // Decline cookies
        declineBtn?.addEventListener('click', () => {
            localStorage.setItem('cookieConsent', 'declined');
            banner.classList.remove('visible');
        });
        
        // If already accepted, initialize analytics
        if (cookieChoice === 'accepted') {
            initAnalytics();
        }
    }

   
    const GA_MEASUREMENT_ID = 'null'; 
    
    function initAnalytics() {
        
        if (GA_MEASUREMENT_ID === 'null') {
            log.debug('[Analytics]', 'ID not configured, skipping...');
            return;
        }

        
        const script = document.createElement('script');
        script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
        script.async = true;
        document.head.appendChild(script);

        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', GA_MEASUREMENT_ID);

        log.info('[Analytics]', 'Initialized with ID', GA_MEASUREMENT_ID);
    }

    // ============ Sticky Navbar with Scroll Effect ============
    function initStickyNavbar() {
        const navbar = document.querySelector('.navbar');
        if (!navbar) return;

        let lastScroll = 0;
        const scrollThreshold = 50; // Add class after 50px scroll

        const handleScroll = rafThrottle(() => {
            const currentScroll = window.pageYOffset || document.documentElement.scrollTop;

            if (currentScroll > scrollThreshold) {
                navbar.classList.add('navbar-scrolled');
            } else {
                navbar.classList.remove('navbar-scrolled');
            }

            lastScroll = currentScroll;
        });

        window.addEventListener('scroll', handleScroll, { passive: true });

        log.debug('[Navbar]', 'Sticky navbar with scroll effect initialized');
    }

    // ============ Initialize All ============
    async function init() {
        injectStructuredData();
        initWebVitals();
        await loadExternalScripts();
        initPreloader();
        initLanguageToggle();
        initMobileMenu();
        initStickyNavbar(); // Sticky navbar with scroll effect
        initMarquee();
        initFAQ();
        initUsecasesScroll();
        initSolanaHit();
        // initMatrix(); // Disabled - using clean gradient background
        initSmoothScroll();
        initScrollAnimations();
        initGSAPAnimations(); // GSAP ScrollTrigger animations
        initWaitlist();
        initMarketplace();
        initCustomCursor();
        initParallax();
        initAsciiRobot();
        initWallet();
        initScrollIndicator();
        initBackToTop();
        initCookieBanner();
    }

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }