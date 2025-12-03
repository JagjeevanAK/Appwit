"use client"

import InputBox from "@/components/inputbox";
import AnimatedBackground from "@/components/animated-background";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

export default function Home() {
    const router = useRouter();
    const { user } = useAuth();

    const handlePromptSubmit = (prompt: string) => {
        if (!user) {
            // Store prompt for after authentication
            localStorage.setItem('pendingPrompt', prompt);
            router.push('/signup');
        } else {
            router.push(`/projects?prompt=${encodeURIComponent(prompt)}`);
        }
    };

    return (
        <div className="relative flex items-center h-screen justify-center flex-col text-white overflow-hidden">
            <AnimatedBackground />
            <div className="z-10 w-full max-w-2xl px-4 flex flex-col items-center gap-8">
                <div className="space-y-2 text-center">
                    <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
                        What do you want to build?
                    </h1>
                    <p className="text-lg text-muted-foreground">
                        Prompt, run, edit, and deploy full-stack web apps.
                    </p>
                </div>

                <div className="w-full">
                    <InputBox
                        width="100%"
                        height="auto"
                        maxHeight="200px"
                        animatedPlaceholder={true}
                        onSendMessage={handlePromptSubmit}
                    />
                </div>

                <div className="flex flex-wrap justify-center gap-2">
                    {[
                        "Build a SaaS landing page",
                        "Create a dashboard with charts",
                        "Make a personal portfolio",
                        "Design an e-commerce store"
                    ].map((prompt, i) => (
                        <button
                            key={i}
                            onClick={() => handlePromptSubmit(prompt)}
                            className="text-sm text-muted-foreground hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-full transition-colors border border-white/10"
                        >
                            {prompt}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}