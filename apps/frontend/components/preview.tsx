"use client";

import { useEffect, useRef, useState } from "react";

interface PreviewProps {
    preview_url: string | null;
    isStreaming?: boolean;
}

export default function Preview({ preview_url, isStreaming = false }: PreviewProps) {
    const lastValidUrlRef = useRef<string | null>(null);
    const [isIframeLoading, setIsIframeLoading] = useState(true);
    const [iframeError, setIframeError] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const wasStreamingRef = useRef(false);

    useEffect(() => {
        if (preview_url) {
            lastValidUrlRef.current = preview_url;
            setIsIframeLoading(true);
            setIframeError(false);
        }
    }, [preview_url]);

    // Refresh iframe when code generation completes (streaming ends)
    useEffect(() => {
        if (wasStreamingRef.current && !isStreaming) {
            // Streaming just finished - refresh iframe
            console.log('[Preview] Code generation completed, refreshing iframe');
            setRefreshKey(prev => prev + 1);
            setIsIframeLoading(true);
        }
        wasStreamingRef.current = isStreaming;
    }, [isStreaming]);

    const displayUrl = preview_url || lastValidUrlRef.current;

    if (!displayUrl) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-[#1D1D1D] rounded-2xl border border-[#2B2B2C]">
                <div className="text-center space-y-4">
                    <div className="flex justify-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
                    </div>
                    <div className="space-y-2">
                        <p className="text-white text-lg font-medium">
                            {isStreaming ? "Generating code..." : "Waiting for code generation..."}
                        </p>
                        <p className="text-gray-400 text-sm">
                            The AI is creating your application
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    const handleIframeLoad = () => {
        setIsIframeLoading(false);
        setIframeError(false);
        console.log('[Preview] Iframe loaded successfully:', displayUrl);
    };

    const handleIframeError = () => {
        setIsIframeLoading(false);
        setIframeError(true);
        console.error('[Preview] Iframe failed to load:', displayUrl);
    };

    return (
        <div className="w-full h-full relative">
            {/* Loading overlay - shown while iframe is loading */}
            {isIframeLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#1D1D1D] rounded-2xl border border-[#2B2B2C] z-10">
                    <div className="text-center space-y-4">
                        <div className="flex justify-center">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
                        </div>
                        <div className="space-y-2">
                            <p className="text-white text-lg font-medium">Loading preview...</p>
                            <p className="text-gray-400 text-sm">Your application is starting up</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Error overlay */}
            {iframeError && !isIframeLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#1D1D1D] rounded-2xl border border-[#2B2B2C] z-10">
                    <div className="text-center space-y-4">
                        <p className="text-white text-lg font-medium">Preview unavailable</p>
                        <p className="text-gray-400 text-sm">The sandbox may be starting up. Please wait...</p>
                        <button
                            onClick={() => {
                                setIsIframeLoading(true);
                                setIframeError(false);
                            }}
                            className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            )}

            <iframe
                key={`${displayUrl}-${refreshKey}`}
                src={displayUrl}
                className="w-full h-full border-0 rounded-2xl"
                title="Application Preview"
                onLoad={handleIframeLoad}
                onError={handleIframeError}
            />
        </div>
    );
}