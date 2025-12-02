'use client'

import { Terminal, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EditorNavProps {
    activeTab: 'preview' | 'code'
    onTabChange: (tab: 'preview' | 'code') => void
}

export default function EditorNav({ activeTab, onTabChange }: EditorNavProps){
    return (
        <nav className='flex gap-1 items-center'>
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
        </nav>
    )
}