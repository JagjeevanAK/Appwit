"use client"

import React, { useState } from "react";
import Editor from "@monaco-editor/react";
import { X } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import FileTree, { FileNode } from "@/components/file-tree";
import { findFileById, updateFileContent, inferLanguage, getInitialFileTree } from "@/lib/file-utils";
import { cn } from "@/lib/utils";

export default function CodeEditor() {
  const [files, setFiles] = useState<FileNode[]>(getInitialFileTree());
  const [openTabs, setOpenTabs] = useState<string[]>(["app-tsx"]); // Track open file IDs
  const [activeFileId, setActiveFileId] = useState<string>("app-tsx");

  const activeFile = findFileById(files, activeFileId);

  const handleFileSelect = (id: string) => {
    const file = findFileById(files, id);
    if (file && file.kind === "file") {
      // Add to open tabs if not already open
      if (!openTabs.includes(id)) {
        setOpenTabs([...openTabs, id]);
      }
      setActiveFileId(id);
    }
  };

  const handleTabClose = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent tab selection when closing
    
    const newOpenTabs = openTabs.filter(tabId => tabId !== id);
    setOpenTabs(newOpenTabs);
    
    // If closing the active tab, switch to another tab
    if (id === activeFileId) {
      if (newOpenTabs.length > 0) {
        // Switch to the last tab in the list
        setActiveFileId(newOpenTabs[newOpenTabs.length - 1]);
      } else {
        setActiveFileId("");
      }
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined && activeFileId) {
      setFiles((prevFiles) => updateFileContent(prevFiles, activeFileId, value));
    }
  };

  return (
    <ResizablePanelGroup 
      direction="horizontal" 
      className="h-full rounded-lg border border-[#2B2B2C]"
    >
      <ResizablePanel defaultSize={20} minSize={15} maxSize={35}>
        <div className="h-full flex flex-col bg-[#1D1D1D]">
          <FileTree
            nodes={files}
            activeId={activeFileId}
            onSelect={handleFileSelect}
          />
        </div>
      </ResizablePanel>

      <ResizableHandle isTransparent />

      <ResizablePanel minSize={50}>
        <div className="h-full flex flex-col">
          {/* Tabs Bar */}
          {openTabs.length > 0 && (
            <div className="flex items-center bg-[#1D1D1D] border-b border-gray-800 overflow-x-auto">
              {openTabs.map((tabId) => {
                const tabFile = findFileById(files, tabId);
                if (!tabFile) return null;
                
                const isActive = tabId === activeFileId;
                
                return (
                  <div
                    key={tabId}
                    onClick={() => setActiveFileId(tabId)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer border-r border-gray-800 hover:bg-[#2D2D2D] group min-w-fit",
                      isActive ? "bg-[#40403F] text-white" : "bg-[#1D1D1D] text-gray-400"
                    )}
                  >
                    <span className="truncate max-w-[150px]">
                      {tabFile.name}
                    </span>
                    <button
                      onClick={(e) => handleTabClose(tabId, e)}
                      className="shrink-0 hover:bg-gray-600 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Editor Area */}
          {activeFile && (
            <div className="flex-1 overflow-hidden">
              <Editor
                key={activeFileId}
                height="100%"
                theme="vs-dark"
                language={inferLanguage(activeFile.name)}
                value={activeFile.content || ""}
                onChange={handleEditorChange}
                path={activeFile.path}
                options={{
                  fontSize: 14,
                  minimap: { enabled: false },
                  wordWrap: "on",
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                }}
              />
            </div>
          )}
          
          {/* Empty State */}
          {!activeFile && openTabs.length === 0 && (
            <div className="h-full flex items-center justify-center text-gray-500">
              <p>Select a file to start editing</p>
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}