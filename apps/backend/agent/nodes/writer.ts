// Writer node - writes generated files to sandbox

import type { Sandbox } from "e2b";
import { log, type GraphStateType, type StreamConfig } from "./types";

export function createWriterNode(sandbox: Sandbox) {
    return async (state: GraphStateType, config?: StreamConfig): Promise<Partial<GraphStateType>> => {
        const { files } = state;

        if (!files || files.length === 0) {
            log.orchestrator('No files to write');
            return { writtenFiles: [] };
        }

        log.orchestrator(`Writing ${files.length} files...`);
        const writtenFiles: string[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!file) continue;

            const fileNum = i + 1;
            log.writer(file.filePath, `Writing [${fileNum}/${files.length}]`);

            config?.configurable?.streamCallback?.({ type: 'file_started', filePath: file.filePath, message: `Writing ${file.filePath}...` });

            try {
                // Create directory if needed
                const dir = file.filePath.substring(0, file.filePath.lastIndexOf('/'));
                if (dir) {
                    await sandbox.commands.run(`mkdir -p ${dir}`);
                }

                // Write file
                await sandbox.files.write(file.filePath, file.content);

                log.writer(file.filePath, 'Done');
                writtenFiles.push(file.filePath);

                config?.configurable?.streamCallback?.({ type: 'file_created', filePath: file.filePath, message: `Created ${file.filePath}` });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log.writer(file.filePath, `Failed: ${errorMessage}`);
                config?.configurable?.streamCallback?.({ type: 'error', message: `Failed to write ${file.filePath}` });
            }
        }

        log.orchestrator(`Written ${writtenFiles.length}/${files.length} files`);
        return { writtenFiles };
    };
}
