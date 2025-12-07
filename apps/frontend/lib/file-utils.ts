import { FileNode } from "@/components/file-tree";

interface SandboxFile {
  name: string;
  type: "file" | "dir";
  path: string;
}

export function findFileById(nodes: FileNode[], id: string): FileNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    if (node.children) {
      const found = findFileById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function inferLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    html: "html",
    css: "css",
    scss: "scss",
    md: "markdown",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
    sql: "sql",
    sh: "shell",
  };
  return languageMap[ext || ""] || "plaintext";
}

export function buildFileTreeFromSandbox(files: SandboxFile[], basePath: string = '/home/user'): FileNode[] {
  const tree: FileNode[] = [];
  const pathMap = new Map<string, FileNode>();

  // First pass: create all nodes and add to pathMap
  for (const file of files) {
    const fullPath = file.path;
    const node: FileNode = {
      id: fullPath,
      name: file.name,
      kind: file.type === 'dir' ? 'folder' : 'file',
      path: fullPath,
      children: file.type === 'dir' ? [] : undefined,
    };
    pathMap.set(fullPath, node);
  }

  // Second pass: build parent-child relationships
  for (const file of files) {
    const node = pathMap.get(file.path)!;
    const parentPath = file.path.substring(0, file.path.lastIndexOf('/'));

    if (parentPath === basePath || parentPath === '') {
      tree.push(node);
    } else {
      const parent = pathMap.get(parentPath);
      if (parent && parent.children) {
        parent.children.push(node);
      } else {
        tree.push(node);
      }
    }
  }

  // Sort: folders first, then alphabetically
  const sortNodes = (nodes: FileNode[]): FileNode[] => {
    nodes.sort((a, b) => {
      if (a.kind === 'folder' && b.kind === 'file') return -1;
      if (a.kind === 'file' && b.kind === 'folder') return 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) {
        sortNodes(node.children);
      }
    }
    return nodes;
  };

  return sortNodes(tree);
}

export async function fetchSandboxFileTree(
  sandboxId: string,
  listFilesFunc: (sandboxId: string, path: string) => Promise<SandboxFile[] | null>,
  basePath: string = '/home/user'
): Promise<FileNode[]> {
  console.log('fetchSandboxFileTree called with:', { sandboxId, basePath });

  const excludeDirs = [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '.vite',
    '.vite-temp',
    '.npm',
    '.cache',
    '.local',
    '.config',
    '.pnpm',
    '.yarn',
    '.bun'
  ];

  const excludeFiles = ['.bash_logout', '.bashrc', '.profile'];

  const allFiles: SandboxFile[] = [];
  const dirsToProcess: string[] = [basePath];
  const processedDirs = new Set<string>();

  while (dirsToProcess.length > 0) {
    const currentPath = dirsToProcess.shift()!;

    if (processedDirs.has(currentPath)) continue;
    processedDirs.add(currentPath);

    console.log('Fetching files from path:', currentPath);
    const files = await listFilesFunc(sandboxId, currentPath);
    console.log('Got files:', files);

    if (!files) continue;

    for (const file of files) {
      const fileName = file.name;

      if (file.type === 'dir' && excludeDirs.includes(fileName)) {
        console.log('Skipping excluded directory:', fileName);
        continue;
      }

      if (file.type === 'file' && excludeFiles.includes(fileName)) {
        console.log('Skipping excluded file:', fileName);
        continue;
      }

      allFiles.push(file);

      if (file.type === 'dir') {
        dirsToProcess.push(file.path);
      }
    }
  }

  console.log('Total files collected:', allFiles.length);
  const tree = buildFileTreeFromSandbox(allFiles, basePath);
  console.log('Built tree with nodes:', tree.length);
  return tree;
}

export async function loadFileContent(
  sandboxId: string,
  filePath: string,
  readFileFunc: (sandboxId: string, path: string) => Promise<string | null>
): Promise<string> {
  console.log('loadFileContent called with:', { sandboxId, filePath });
  console.log('readFileFunc type:', typeof readFileFunc);

  const content = await readFileFunc(sandboxId, filePath);
  console.log('Content received:', content ? `${content.length} chars` : 'null');

  return content || '// Unable to load file content';
}

export function updateFileNodeWithContent(
  nodes: FileNode[],
  id: string,
  content: string
): FileNode[] {
  return nodes.map((node) => {
    if (node.id === id) {
      return { ...node, content };
    }
    if (node.children) {
      return {
        ...node,
        children: updateFileNodeWithContent(node.children, id, content),
      };
    }
    return node;
  });
}

export function mergeFileTrees(
  oldTree: FileNode[],
  newTree: FileNode[]
): FileNode[] {
  const oldNodeMap = new Map<string, FileNode>();

  const buildNodeMap = (nodes: FileNode[]) => {
    for (const node of nodes) {
      oldNodeMap.set(node.id, node);
      if (node.children) {
        buildNodeMap(node.children);
      }
    }
  };
  buildNodeMap(oldTree);

  const mergeNodes = (newNodes: FileNode[]): FileNode[] => {
    return newNodes.map((newNode) => {
      const oldNode = oldNodeMap.get(newNode.id);

      if (!oldNode) {
        return newNode;
      }

      const mergedNode: FileNode = {
        ...newNode,
        content: oldNode.content, // Preserve existing content
      };

      if (newNode.children && oldNode.children) {
        mergedNode.children = mergeNodes(newNode.children);
      } else if (newNode.children) {
        mergedNode.children = mergeNodes(newNode.children);
      }

      return mergedNode;
    });
  };

  return mergeNodes(newTree);
}
