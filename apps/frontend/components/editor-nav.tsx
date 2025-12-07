'use client'

import { Terminal, Eye, Download, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { BackendUrl } from '@/config'

interface EditorNavProps {
    activeTab: 'preview' | 'code'
    onTabChange: (tab: 'preview' | 'code') => void
    sandboxId: string | null
}

export default function EditorNav({ activeTab, onTabChange, sandboxId }: EditorNavProps) {
    const [isDownloading, setIsDownloading] = useState(false)

    const handleDownload = async () => {
        if (!sandboxId || isDownloading) return

        setIsDownloading(true)
        try {
            const response = await fetch(`${BackendUrl}/prompt/download/${sandboxId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                }
            })

            if (!response.ok) {
                throw new Error('Failed to download project')
            }

            const blob = await response.blob()

            const url = window.URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `project-${Date.now()}.tar.gz`
            document.body.appendChild(a)
            a.click()

            // Cleanup
            window.URL.revokeObjectURL(url)
            document.body.removeChild(a)
        } catch (error) {
            console.error('Download failed:', error)
            alert('Failed to download project. Please try again.')
        } finally {
            setIsDownloading(false)
        }
    }

    return (
        <nav className='flex justify-between items-center w-full'>
            {/* Left side - Preview and Code tabs */}
            <div className="flex gap-1 items-center">
                <button
                    className={cn(
                        'rounded-lg px-2 py-1.5 h-8 flex items-center justify-center cursor-pointer transition-all duration-300 text-white overflow-hidden',
                        activeTab === 'preview'
                            ? 'bg-blue-600 border border-blue-500 w-auto'
                            : 'bg-transparent border border-gray-700 hover:bg-gray-800 w-8'
                    )}
                    onClick={() => onTabChange('preview')}
                >
                    <div className="flex items-center justify-center gap-1">
                        <Eye className="h-4 w-4 shrink-0" />
                        {activeTab === 'preview' && <span className='whitespace-nowrap text-sm transition-all duration-300'>Preview</span>}
                    </div>
                </button>
                <button
                    className={cn(
                        'rounded-lg px-2 py-1.5 h-8 flex items-center justify-center cursor-pointer transition-all duration-300 text-white overflow-hidden',
                        activeTab === 'code'
                            ? 'bg-blue-600 border border-blue-500 w-auto'
                            : 'bg-transparent border border-gray-700 hover:bg-gray-800 w-8'
                    )}
                    onClick={() => onTabChange('code')}
                >
                    <div className="flex items-center justify-center gap-1">
                        <Terminal className="h-4 w-4 shrink-0" />
                        {activeTab === 'code' && <span className='whitespace-nowrap text-sm transition-all duration-300'>Code</span>}
                    </div>
                </button>
            </div>

            {/* Right side - Download Button */}
            <button
                className={cn(
                    'rounded-lg px-2 py-1.5 h-8 flex items-center justify-center cursor-pointer transition-all duration-300 text-white overflow-hidden',
                    'bg-transparent border border-gray-700 hover:bg-gray-800 hover:border-green-600',
                    isDownloading && 'opacity-50 cursor-not-allowed',
                    !sandboxId && 'opacity-30 cursor-not-allowed'
                )}
                onClick={handleDownload}
                disabled={!sandboxId || isDownloading}
                title={sandboxId ? 'Download project as zip' : 'Waiting for sandbox...'}
            >
                <div className="flex items-center justify-center gap-1">
                    {isDownloading ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    ) : (
                        <Download className="h-4 w-4 shrink-0" />
                    )}
                </div>
            </button>
        </nav>
    )
}