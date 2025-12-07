"use client"

import { createContext, useContext, useState, ReactNode, useEffect } from 'react'
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
    const [user, setUser] = useState<User | null>(null)
    const [token, setToken] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const router = useRouter()

    // Load auth state from localStorage on mount
    useEffect(() => {
        const storedUser = localStorage.getItem('user')
        const storedToken = localStorage.getItem('auth_token')

        if (storedUser && storedToken) {
            setUser(JSON.parse(storedUser))
            setToken(storedToken)
        }
        setLoading(false)
    }, [])

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
            localStorage.setItem('auth_token', data.token)
            localStorage.setItem('user', JSON.stringify(data.user))
            setToken(data.token)
            setUser(data.user)

            // Check for pending prompt - navigate to project creation
            const pendingPrompt = localStorage.getItem('pendingPrompt')
            if (pendingPrompt) {
                // Keep the prompt, project page will handle it
                router.push('/project')
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
            localStorage.setItem('auth_token', data.token)
            localStorage.setItem('user', JSON.stringify(data.user))
            setToken(data.token)
            setUser(data.user)

            // Check for pending prompt - navigate to project creation
            const pendingPrompt = localStorage.getItem('pendingPrompt')
            if (pendingPrompt) {
                // Keep the prompt, project page will handle it
                router.push('/project')
            } else {
                router.push('/')
            }
        } finally {
            setLoading(false)
        }
    }

    const signout = () => {
        localStorage.removeItem('auth_token')
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
