"use client"

import React, { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type FileNode = {
  id: string;
  name: string;
  kind: "file" | "folder";
  children?: FileNode[];
  content?: string;
  path: string;
};

interface FileTreeProps {
  nodes: FileNode[];
  activeId?: string;
  onSelect: (id: string) => void;
  level?: number;
}

interface FileTreeItemProps {
  node: FileNode;
  activeId?: string;
  onSelect: (id: string) => void;
  level: number;
  searchQuery?: string;
}

function nodeMatchesSearch(node: FileNode, query: string): boolean {
  if (!query) return true;

  const lowerQuery = query.toLowerCase();

  if (node.name.toLowerCase().includes(lowerQuery)) {
    return true;
  }

  if (node.children) {
    return node.children.some(child => nodeMatchesSearch(child, query));
  }

  return false;
}

// Check if a folder contains the active file (directly or nested)
function folderContainsActiveFile(node: FileNode, activeId: string | undefined): boolean {
  if (!activeId || node.kind !== "folder" || !node.children) return false;

  for (const child of node.children) {
    if (child.id === activeId) return true;
    if (child.kind === "folder" && folderContainsActiveFile(child, activeId)) {
      return true;
    }
  }
  return false;
}

function FileTreeItem({ node, activeId, onSelect, level, searchQuery = "" }: FileTreeItemProps) {
  // Auto-expand folders that contain the active file
  const shouldAutoExpand = useMemo(() => {
    return folderContainsActiveFile(node, activeId);
  }, [node, activeId]);

  const [isExpanded, setIsExpanded] = useState(shouldAutoExpand);
  const isActive = activeId === node.id;
  const isFolder = node.kind === "folder";

  // Update expansion state when active file changes
  React.useEffect(() => {
    if (shouldAutoExpand && !isExpanded) {
      setIsExpanded(true);
    }
  }, [shouldAutoExpand, isExpanded]);

  const shouldShow = nodeMatchesSearch(node, searchQuery);
  
  if (!shouldShow) return null;

  const handleClick = () => {
    if (isFolder) {
      setIsExpanded(!isExpanded);
    } else {
      onSelect(node.id);
    }
  };

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-[#626261] text-sm text-white",
            isActive && "bg-[#212835] text-white"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
      >
        {isFolder ? (
          <>
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-white" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-white" />
            )}
          </>
        ) : (
          <>
            <span className="w-4" />
            <File className="h-4 w-4 shrink-0 text-white" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </div>

      {isFolder && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.id}
              node={child}
              activeId={activeId}
              onSelect={onSelect}
              level={level + 1}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileTree({ nodes, activeId, onSelect, level = 0 }: FileTreeProps) {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="h-full flex flex-col bg-[#1D1D1D]">
      {/* Search Input */}
      <div className="px-2 py-1.5 border-b border-gray-800">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#2D2D2D] text-white text-sm pl-8 pr-3 py-1.5 rounded border border-gray-700 focus:border-blue-500 focus:outline-none placeholder-gray-500"
          />
        </div>
      </div>
      
      {/* File Tree */}
      <div className="flex-1 overflow-auto">
        <div className="py-2">
          {nodes.map((node) => (
            <FileTreeItem
              key={node.id}
              node={node}
              activeId={activeId}
              onSelect={onSelect}
              level={level}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
