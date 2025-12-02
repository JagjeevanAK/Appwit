interface PreviewProps {
    preview_url: string | null;
    isStreaming?: boolean;
}

export default function Preview({ preview_url, isStreaming = false }: PreviewProps) {
    if (!preview_url) {
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
    
    return (
        <iframe
            src={preview_url}
            className="w-full h-full border-0 rounded-2xl"
            title="Application Preview"
        ></iframe>
    );
}