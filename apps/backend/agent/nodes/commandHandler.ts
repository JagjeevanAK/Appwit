// Command handler node - runs npm/npx commands in sandbox

import type { Sandbox } from "e2b";
import { log, type GraphStateType, type StreamConfig } from "./types";

export function createCommandHandlerNode(sandbox: Sandbox) {
    return async (state: GraphStateType, config?: StreamConfig): Promise<Partial<GraphStateType>> => {
        const commands = state.commands || [];

        if (commands.length === 0) {
            log.commands('No commands to execute');
            return {};
        }

        log.commands(`Running ${commands.length} commands sequentially...`);

        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];
            if (!cmd) continue;

            const cmdNum = i + 1;
            log.commands(`[${cmdNum}/${commands.length}] ${cmd}`);

            config?.configurable?.streamCallback?.({ type: 'executing', message: `Running: ${cmd}` });

            try {
                const cmdToRun = `yes | ${cmd}`;
                log.commands(`Running: ${cmdToRun}`);

                const result = await sandbox.commands.run(cmdToRun, {
                    cwd: '/home/user',
                    timeoutMs: 120_000, // 2 min timeout for npm installs
                });

                if (result.stdout) {
                    log.commands(`stdout: ${result.stdout.slice(0, 200)}`);
                    config?.configurable?.streamCallback?.({ type: 'stdout', message: result.stdout });
                }
                if (result.stderr) {
                    log.commands(`stderr: ${result.stderr.slice(0, 200)}`);
                    config?.configurable?.streamCallback?.({ type: 'stderr', message: result.stderr });
                }

                if (result.exitCode !== 0) {
                    log.commands(`Command failed with exit code ${result.exitCode}`);
                    config?.configurable?.streamCallback?.({ type: 'error', message: `Command failed: ${cmd}` });
                    // Continue with other commands even if one fails
                }

                config?.configurable?.streamCallback?.({ type: 'completed', message: `Completed: ${cmd}` });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log.commands(`Command error: ${errorMessage}`);
                config?.configurable?.streamCallback?.({ type: 'error', message: `Error: ${errorMessage}` });
            }
        }

        log.commands('All commands executed');
        return { commands: [] }; // Clear commands after execution
    };
}
