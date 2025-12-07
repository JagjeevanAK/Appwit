"use client"
import { ArrowUp } from 'lucide-react';
import { cn } from "@/lib/utils"
import { useRef, useState, useEffect } from 'react';

interface InputBoxProps {
    height?: string;
    width?: string;
    maxHeight?: string;
    style?: string;
    onSendMessage?: (message: string) => void;
    animatedPlaceholder?: boolean;
    placeholders?: string[];
}

export default function InputBox({
    width,
    height,
    maxHeight = "max-h-[200px]",
    style,
    onSendMessage,
    animatedPlaceholder = false,
    placeholders = [
        "Build a prototype...",
        "Build a dashboard...",
        "Build an enterprise solution...",
        "Build a landing page...",
        "Build a mobile app...",
        "Build an e-commerce site...",
        "Build a portfolio...",
        "Build a CRM system..."
    ]
}: InputBoxProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [input, setInput] = useState<string>("");
    const [currentPlaceholder, setCurrentPlaceholder] = useState<string>(animatedPlaceholder ? "" : "Type your message...");
    const [placeholderIndex, setPlaceholderIndex] = useState<number>(0);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);
    const [charIndex, setCharIndex] = useState<number>(0);

    useEffect(() => {
        if (!animatedPlaceholder) {
            return;
        }

        const currentText = placeholders[placeholderIndex];

        if (!isDeleting && charIndex < currentText.length) {
            const timeout = setTimeout(() => {
                setCurrentPlaceholder(currentText.slice(0, charIndex + 1));
                setCharIndex(charIndex + 1);
            }, 100);
            return () => clearTimeout(timeout);
        } else if (!isDeleting && charIndex === currentText.length) {
            const timeout = setTimeout(() => {
                setIsDeleting(true);
            }, 2000);
            return () => clearTimeout(timeout);
        } else if (isDeleting && charIndex > 0) {
            const timeout = setTimeout(() => {
                setCurrentPlaceholder(currentText.slice(0, charIndex - 1));
                setCharIndex(charIndex - 1);
            }, 50);
            return () => clearTimeout(timeout);
        } else if (isDeleting && charIndex === 0) {
            const timeout = setTimeout(() => {
                setIsDeleting(false);
                setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
            }, 0);
            return () => clearTimeout(timeout);
        }
    }, [charIndex, isDeleting, placeholderIndex, animatedPlaceholder, placeholders]);

    const handleInput = () => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        }
    };

    const handleSend = () => {
        if (input.trim() === "") return;
        if (onSendMessage) {
            onSendMessage(input);
        }
        setInput("");
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
    };

    return (
        <div
            className={cn(
                "relative flex flex-col w-full p-3 overflow-hidden border rounded-xl bg-background focus-within:ring-1 focus-within:ring-ring border-input shadow-sm transition-all duration-200"
            )}
            style={{
                width: width,
                height: height,
                maxHeight: maxHeight?.startsWith('max-h-') ? undefined : maxHeight
            }}
        >
            <textarea
                ref={textareaRef}
                autoFocus
                onInput={handleInput}
                onChange={(e) => setInput(e.target.value)}
                className={cn(
                    "w-full resize-none bg-transparent px-2 py-2 text-base outline-none placeholder:text-muted-foreground min-h-[60px] text-foreground",
                    style,
                    maxHeight?.startsWith('max-h-') ? maxHeight : undefined
                )}
                placeholder={currentPlaceholder}
                value={input}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                    }
                }}
            />
            <div className="flex justify-end mt-2">
                <button
                    className={cn(
                        "inline-flex items-center justify-center rounded-lg p-2 transition-colors",
                        input.trim()
                            ? "bg-primary text-primary-foreground hover:bg-primary/90"
                            : "bg-muted text-muted-foreground cursor-not-allowed"
                    )}
                    onClick={handleSend}
                    disabled={!input.trim()}
                >
                    <ArrowUp className="h-4 w-4" />
                </button>
            </div>
        </div>
    )
}