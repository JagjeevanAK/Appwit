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
AVAILABLE THEMES (choose one):
- "vercel" - Vercel's black & white, ultra-minimal, developer-focused
- "twitter" - Twitter/X bright blue, social media aesthetic
- "darkmatter" - Developer-focused with monospace fonts, orange/amber primary
- "caffeine" - Warm coffee-inspired, brown/amber colors
- "claymorphism" - Soft clay-like 3D aesthetic, purple, playful
- "graphite" - Minimalist grayscale, professional, sharp edges
- "mocha-mousse" - Pantone 2025 warm cocoa, cozy and inviting
- "elegant-luxury" - Premium burgundy/wine with gold accents
- "sage-garden" - Nature-inspired sage green, botanical
- "amethyst-haze" - Soft purple/lavender, dreamy mystical
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
