"use client"

import { Suspense } from "react"
import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

function AuthCallbackContent() {
    const router = useRouter()
    const searchParams = useSearchParams()

    useEffect(() => {
        const token = searchParams.get("token")
        const userParam = searchParams.get("user")
        const error = searchParams.get("error")

        if (error) {
            router.push(`/login?error=${error}`)
            return
        }

        if (token && userParam) {
            try {
                const user = JSON.parse(userParam)
                localStorage.setItem("auth_token", token)
                localStorage.setItem("user", JSON.stringify(user))

                // Check for pending prompt
                const pendingPrompt = localStorage.getItem("pendingPrompt")
                if (pendingPrompt) {
                    router.push("/project")
                } else {
                    router.push("/")
                }
            } catch {
                router.push("/login?error=invalid_response")
            }
        } else {
            router.push("/login")
        }
    }, [router, searchParams])

    return (
        <div className="flex min-h-screen items-center justify-center bg-[#1D1D1D]">
            <div className="text-white">Signing in...</div>
        </div>
    )
}

export default function AuthCallback() {
    return (
        <Suspense fallback={
            <div className="flex min-h-screen items-center justify-center bg-[#1D1D1D]">
                <div className="text-white">Signing in...</div>
            </div>
        }>
            <AuthCallbackContent />
        </Suspense>
    )
}
