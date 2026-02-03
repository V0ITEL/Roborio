(() => {
  const structuredData = [
    {
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
    },
    {
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
      "sameAs": []
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What is Roborio?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Roborio is a decentralized marketplace built on Solana where businesses can rent robots on-demand. Think of it as Uber for robots - operators list their robots, businesses rent them for specific tasks, and payments are handled automatically via smart contracts."
          }
        },
        {
          "@type": "Question",
          "name": "How do payments work?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Payments are handled via on-chain escrow on Solana. Funds are locked until the task is completed, with transparent release and cancellation rules."
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
            "text": "The MVP demo is live today, and we're onboarding pilot customers now. Join the waitlist to secure early access and priority reservations."
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
            "text": "Yes, our REST API allows businesses to integrate robot rentals directly into their operations. Schedule recurring tasks, manage fleets, track robots in real-time, and automate payments - all programmatically."
          }
        }
      ]
    }
  ];

  const mount = document.head || document.body;
  if (!mount) {
    return;
  }

  structuredData.forEach((entry) => {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(entry);
    mount.appendChild(script);
  });
})();
