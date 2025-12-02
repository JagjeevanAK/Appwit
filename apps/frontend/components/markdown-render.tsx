import ReactMarkdown from 'react-markdown'

export default function MarkdownRenderer({ markdown }: { markdown: string }) {
    return (
        <div>
            <ReactMarkdown>{markdown}</ReactMarkdown>
        </div>
    )
}