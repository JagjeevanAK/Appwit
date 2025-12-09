import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-8">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Welcome to Your App</CardTitle>
                    <CardDescription>
                        Built with Next.js, TypeScript, Tailwind CSS, and shadcn/ui
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-muted-foreground">
                        Start editing <code className="bg-muted px-1 rounded">app/page.tsx</code> to build your application.
                    </p>
                    <Button className="w-full bg-black text-white hover:bg-black/90">
                        Get Started
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
