"use client"

import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import ChatBar from "@/components/Chatbar"
import CodeEditor from "@/components/editor"
import { useStream } from "@/hooks/useStream"

export default function Home() {
  const streamState = useStream();

  return (
    <div className="h-screen w-screen bg-[#1D1D1D] flex items-center justify-center">
      <div className="relative w-[calc(100vw-20px)] h-[calc(100vh-20px)]">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={25} minSize={20}>
            <ChatBar streamState={streamState} />
          </ResizablePanel>

          <ResizableHandle isTransparent />

          <ResizablePanel defaultSize={75} minSize={65}>
            <CodeEditor streamState={streamState} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}
