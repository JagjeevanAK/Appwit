// Shared constants used across multiple prompts

export const initialFileStructure = `
    PROJECT ROOT (/home/user/):
    - package.json (Next.js 15, Drizzle ORM, shadcn/ui)
    - next.config.ts
    - tsconfig.json
    - components.json (shadcn config)
    - drizzle.config.ts
    - middleware.ts (request logging, auth, redirects)

    APP DIRECTORY (/home/user/app/):
    - layout.tsx (root layout with metadata)
    - page.tsx (home page)
    - globals.css (@import "tailwindcss" ready)
    - api/hello/route.ts (example API route)

    COMPONENTS (/home/user/components/ui/):
    - button.tsx, card.tsx, input.tsx (pre-installed)
    - dialog.tsx, tabs.tsx, avatar.tsx (pre-installed)

    LIB DIRECTORY (/home/user/lib/):
    - utils.ts (cn function for Tailwind)
    - db/index.ts (Drizzle connection)
    - db/schema.ts (database schema)
`;

export const AVAILABLE_THEMES = `
THEME SELECTION (MANDATORY - you MUST choose one):
The theme CSS will be automatically copied from our theme library to globals.css.
Do NOT generate or modify globals.css - the themeApplicator handles this automatically.

AVAILABLE THEMES:

1. "vercel" - Vercel's iconic black & white
   Best for: Developer platforms, SaaS, tech startups, deployment tools, modern web apps

2. "twitter" - Twitter/X bright blue
   Best for: Social apps, communication platforms, news feeds, messaging, media

3. "darkmatter" - Developer-focused with monospace fonts, orange/amber + teal
   Best for: Developer tools, code editors, technical dashboards, CLI apps, documentation

4. "caffeine" - Warm coffee-inspired, brown/amber
   Best for: Coffee shops, food apps, cozy blogs, productivity apps, notes apps

5. "claymorphism" - Soft clay-like 3D, purple, playful
   Best for: Creative portfolios, design tools, kids apps, playful websites

6. "graphite" - Minimalist grayscale, professional, sharp edges
   Best for: Business apps, enterprise software, admin panels, minimalist sites

7. "mocha-mousse" - Pantone 2025 warm cocoa, cozy
   Best for: Lifestyle blogs, recipe apps, wellness apps, boutique shops

8. "elegant-luxury" - Premium burgundy/wine with gold accents
   Best for: Luxury brands, jewelry stores, high-end restaurants, fashion, premium services

9. "sage-garden" - Nature-inspired sage green, botanical
   Best for: Eco brands, plant shops, wellness apps, sustainable products

10. "amethyst-haze" - Soft purple/lavender, dreamy mystical
    Best for: Creative apps, music platforms, art portfolios, beauty products

THEME SELECTION RULES:
- ALWAYS set "theme": "themename" in your JSON output
- The theme CSS is pre-built and will be copied automatically
- Do NOT create or modify globals.css - theme is auto-applied
- Choose the theme that BEST matches the project's industry/vibe
`;

export const PROJECT_STRUCTURE = `
/home/user/
├── app/
│   ├── page.tsx (home page)
│   ├── layout.tsx (root layout)
│   ├── globals.css
│   └── api/
│       └── [route]/route.ts (API routes)
├── components/
│   └── ui/ (shadcn components)
├── lib/
│   ├── utils.ts
│   └── db/
│       ├── index.ts (Drizzle connection)
│       └── schema.ts (database schema)
└── middleware.ts
`;

export const PRE_CONFIGURED_ENVIRONMENT = `
PRE-CONFIGURED ENVIRONMENT:
- Next.js 15 with App Router and Turbopack
- Tailwind CSS 4 ready (@import "tailwindcss" in globals.css)
- PostgreSQL database with Drizzle ORM configured
- shadcn/ui: button, card, input, dialog, tabs, avatar pre-installed
- Server Components are default, use "use client" for client components
- Path alias @ points to project root
`;

export const COMMON_IMPORTS = `
IMPORTS:
- import { Button } from "@/components/ui/button"
- import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
- import { Input } from "@/components/ui/input"
- import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
- import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
- import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
- import { cn } from "@/lib/utils"
- import { IconName } from "lucide-react"
- import { db } from "@/lib/db"
- import { tableName } from "@/lib/db/schema"
- import { eq } from "drizzle-orm"
- import { NextResponse } from "next/server"
`;

export const OUTPUT_FORMAT = `
YOUR OUTPUT FORMAT:
Return ONLY valid JSON with theme, files, and commands:
{
  "theme": "vercel",
  "files": [
    { "filePath": "/home/user/app/page.tsx", "content": "..." }
  ],
  "commands": []
}
`;
