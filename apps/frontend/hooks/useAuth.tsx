"use client"

import { createContext, useContext, useState, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { BackendUrl } from '@/config'

interface User {
    id: string
    email: string
    name: string | null
}

interface AuthContextType {
    user: User | null
    token: string | null
    loading: boolean
    signin: (email: string, password: string) => Promise<void>
    signup: (email: string, password: string, name?: string) => Promise<void>
    signout: () => void
    signinWithGoogle: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(() => {
        if (typeof window !== 'undefined') {
            const storedUser = localStorage.getItem('user')
            return storedUser ? JSON.parse(storedUser) : null
        }
        return null
    })
    const [token, setToken] = useState<string | null>(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('token')
        }
        return null
    })
    const [loading, setLoading] = useState(false)
    const router = useRouter()

    const signin = async (email: string, password: string) => {
        setLoading(true)
        try {
            const res = await fetch(`${BackendUrl}/auth/signin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            })

            if (!res.ok) {
                const error = await res.json()
                throw new Error(error.error || 'Sign in failed')
            }

            const data = await res.json()
            localStorage.setItem('token', data.token)
            localStorage.setItem('user', JSON.stringify(data.user))
            setToken(data.token)
            setUser(data.user)

            // Check for pending prompt
            const pendingPrompt = localStorage.getItem('pendingPrompt')
            if (pendingPrompt) {
                localStorage.removeItem('pendingPrompt')
                router.push(`/projects?prompt=${encodeURIComponent(pendingPrompt)}`)
            } else {
                router.push('/')
            }
        } finally {
            setLoading(false)
        }
    }

    const signup = async (email: string, password: string, name?: string) => {
        setLoading(true)
        try {
            const res = await fetch(`${BackendUrl}/auth/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, name }),
            })

            if (!res.ok) {
                const error = await res.json()
                throw new Error(error.error || 'Sign up failed')
            }

            const data = await res.json()
            localStorage.setItem('token', data.token)
            localStorage.setItem('user', JSON.stringify(data.user))
            setToken(data.token)
            setUser(data.user)

            // Check for pending prompt
            const pendingPrompt = localStorage.getItem('pendingPrompt')
            if (pendingPrompt) {
                localStorage.removeItem('pendingPrompt')
                router.push(`/projects?prompt=${encodeURIComponent(pendingPrompt)}`)
            } else {
                router.push('/')
            }
        } finally {
            setLoading(false)
        }
    }

    const signout = () => {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        setToken(null)
        setUser(null)
        router.push('/login')
    }

    const signinWithGoogle = () => {
        window.location.href = `${BackendUrl}/auth/google`
    }

    return (
        <AuthContext.Provider value={{ user, token, loading, signin, signup, signout, signinWithGoogle }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const context = useContext(AuthContext)
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider')
    }
    return context
}
