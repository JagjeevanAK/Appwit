"use client"

import React, { useState, useEffect, useCallback, useRef } from "react";
import Editor from "@monaco-editor/react";
import { X } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import FileTree, { FileNode } from "@/components/file-tree";
import { findFileById, inferLanguage, fetchSandboxFileTree, loadFileContent, updateFileNodeWithContent, mergeFileTrees } from "@/lib/file-utils";
import { cn } from "@/lib/utils";
import EditorNav from "./editor-nav";
import Preview from "./preview";
import { useSandboxFiles } from "@/hooks/useSandboxFiles";
import type { FileChange } from "@/hooks/useStream";

interface CodeEditorProps {
  streamState: {
    data: string;
    isStreaming: boolean;
    error: string | null;
    sandboxUrl: string | null;
    sandboxId: string | null;
    fileChanges: FileChange[];
    startStream: (prompt: string, backendUrl?: string) => Promise<void>;
    stopStream: () => void;
    resetStream: () => void;
    clearFileChanges: () => void;
  };
}

export default function CodeEditor({ streamState }: CodeEditorProps) {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeFileId, setActiveFileId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const { sandboxUrl, sandboxId, isStreaming, fileChanges, clearFileChanges } = streamState;
  const { listFiles, readFile } = useSandboxFiles();
  const [hasInitialLoad, setHasInitialLoad] = useState(false);
  const processedChangesRef = useRef<number>(0);

  const findFirstFile = useCallback((nodes: FileNode[]): FileNode | null => {
    for (const node of nodes) {
      if (node.kind === 'file') return node;
      if (node.children) {
        const found = findFirstFile(node.children);
        if (found) return found;
      }
    }
    return null;
  }, []);

  const loadSandboxFiles = useCallback(async (isRefetch = false) => {
    if (!sandboxId) {
      console.log('No sandboxId available yet');
      return;
    }
    
    if (!isRefetch) {
      setIsLoadingFiles(true);
    }
    
    console.log(isRefetch ? 'Refetching files from sandbox:' : 'Starting to load files from sandbox:', sandboxId);
    
    try {
      const fileTree = await fetchSandboxFileTree(sandboxId, listFiles);
      console.log('Fetched file tree:', fileTree);
      
      if (fileTree && fileTree.length > 0) {
        setFiles(prevFiles => {
          if (isRefetch && prevFiles.length > 0) {
            return mergeFileTrees(prevFiles, fileTree);
          }
          return fileTree;
        });
        console.log('Files set, count:', fileTree.length);
        
        if (!isRefetch && !hasInitialLoad) {
          const firstFile = findFirstFile(fileTree);
          if (firstFile) {
            console.log('First file found:', firstFile.name);
            setOpenTabs([firstFile.id]);
            setActiveFileId(firstFile.id);
          }
          setHasInitialLoad(true);
        } else if (isRefetch && activeFileId) {
          // Reload content for currently active file
          console.log('Reloading content for active file:', activeFileId);
          const activeFile = findFileById(fileTree, activeFileId);
          if (activeFile && activeFile.kind === 'file') {
            try {
              const content = await loadFileContent(sandboxId, activeFile.path, readFile);
              setFiles(prevFiles => updateFileNodeWithContent(prevFiles, activeFileId, content));
              console.log('Active file content reloaded smoothly');
            } catch (error) {
              console.error('Error reloading active file:', error);
            }
          }
        }
      } else {
        console.log('File tree is empty or null');
      }
    } catch (error) {
      console.error('Error loading sandbox files:', error);
    } finally {
      if (!isRefetch) {
        console.log('Setting isLoadingFiles to false');
        setIsLoadingFiles(false);
      }
    }
  }, [sandboxId, listFiles, findFirstFile, hasInitialLoad, activeFileId, readFile]);

  useEffect(() => {
    if (sandboxId && !hasInitialLoad) {
      loadSandboxFiles(false);
    }
  }, [sandboxId, hasInitialLoad, loadSandboxFiles]);

  useEffect(() => {
    if (!sandboxId || !hasInitialLoad || fileChanges.length === 0) {
      return;
    }

    const newChanges = fileChanges.slice(processedChangesRef.current);
    if (newChanges.length === 0) return;

    processedChangesRef.current = fileChanges.length;

    const processChanges = async () => {
      for (const change of newChanges) {
        console.log('Live file update:', change.action, change.path);
        
        if (change.action === 'create' || change.action === 'update') {
          try {
            const content = await readFile(sandboxId, change.path);
            if (content) {
              setFiles(prevFiles => {
                const existingFile = findFileById(prevFiles, change.path);
                if (existingFile) {
                  return updateFileNodeWithContent(prevFiles, change.path, content);
                }
                return prevFiles;
              });
            }
          } catch (error) {
            console.error('Error fetching updated file:', error);
          }
        }
      }
      
      await loadSandboxFiles(true);
    };

    processChanges();
  }, [fileChanges, sandboxId, hasInitialLoad, loadSandboxFiles, readFile]);

  useEffect(() => {
    if (!isStreaming || !sandboxId || !hasInitialLoad) {
      return;
    }

    const pollInterval = setInterval(() => {
      loadSandboxFiles(true);
    }, 3000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [isStreaming, sandboxId, hasInitialLoad, loadSandboxFiles]);

  useEffect(() => {
    if (!isStreaming && hasInitialLoad && sandboxId) {
      console.log('Streaming completed, final refetch...');
      loadSandboxFiles(true);
      processedChangesRef.current = 0;
      clearFileChanges();
    }
  }, [isStreaming, hasInitialLoad, sandboxId, loadSandboxFiles, clearFileChanges]);

  const activeFile = findFileById(files, activeFileId);

  const handleFileSelect = async (id: string) => {
    const file = findFileById(files, id);
    console.log('File selected:', { id, file, hasContent: !!file?.content, sandboxId });
    
    if (file && file.kind === "file") {
      if (!openTabs.includes(id)) {
        setOpenTabs([...openTabs, id]);
      }
      setActiveFileId(id);
      
      if (!file.content && sandboxId) {
        console.log('Loading content for file:', file.path);
        try {
          const content = await loadFileContent(sandboxId, file.path, readFile);
          console.log('Content loaded, length:', content?.length);
          setFiles(prevFiles => updateFileNodeWithContent(prevFiles, id, content));
        } catch (error) {
          console.error('Error loading file content:', error);
        }
      } else {
        console.log('File already has content or no sandboxId');
      }
    }
  };

  const handleTabClose = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const newOpenTabs = openTabs.filter(tabId => tabId !== id);
    setOpenTabs(newOpenTabs);
    
    if (id === activeFileId) {
      if (newOpenTabs.length > 0) {
        setActiveFileId(newOpenTabs[newOpenTabs.length - 1]);
      } else {
        setActiveFileId("");
      }
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="w-full text-white px-2 pb-2">
        <EditorNav activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
      {activeTab === 'preview' ? (
        <Preview preview_url={sandboxUrl} isStreaming={isStreaming} />
      ) : (
      <ResizablePanelGroup 
        direction="horizontal" 
        className="flex-1 rounded-lg border border-[#2B2B2C]"
      >
        <ResizablePanel defaultSize={20} minSize={15} maxSize={35}>
          <div className="h-full flex flex-col bg-[#1D1D1D]">
            {isLoadingFiles ? (
              <div className="h-full flex items-center justify-center text-gray-400">
                <div className="text-center space-y-2">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto"></div>
                  <p className="text-sm">Loading files...</p>
                </div>
              </div>
            ) : files.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400">
                <div className="text-center space-y-2">
                  <p className="text-sm">No files available</p>
                  <p className="text-xs text-gray-500">Send a prompt to generate code</p>
                </div>
              </div>
            ) : (
              <FileTree
                nodes={files}
                activeId={activeFileId}
                onSelect={handleFileSelect}
              />
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle isTransparent />

        <ResizablePanel defaultSize={80} minSize={50}>
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
                  path={activeFile.path}
                  options={{
                    fontSize: 14,
                    minimap: { enabled: false },
                    wordWrap: "on",
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    readOnly: true,
                    smoothScrolling: true,
                    cursorSmoothCaretAnimation: "on",
                    renderLineHighlight: "all",
                    renderWhitespace: "none",
                  }}
                  loading={
                    <div className="h-full flex items-center justify-center bg-[#1E1E1E]">
                      <div className="animate-pulse text-gray-400">Loading content...</div>
                    </div>
                  }
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
      )}
    </div>
  );
}