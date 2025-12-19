// Theme applicator node - applies CSS theme to globals.css

import type { Sandbox } from "e2b";
import { getThemeCSS } from "../../data/themes";
import { log, type GraphStateType, type StreamConfig } from "./types";

export function createThemeApplicatorNode(sandbox: Sandbox) {
    return async (state: GraphStateType, config?: StreamConfig): Promise<Partial<GraphStateType>> => {
        const themeName = state.theme;

        if (!themeName) {
            log.theme('No theme specified, using default');
            return {};
        }

        log.theme(`Applying theme: ${themeName}`);
        config?.configurable?.streamCallback?.({ type: 'executing', message: `Applying theme: ${themeName}` });

        try {
            const themeCSS = getThemeCSS(themeName);

            if (!themeCSS) {
                log.theme(`Theme "${themeName}" not found, skipping`);
                return {};
            }

            await sandbox.files.write('/home/user/app/globals.css', themeCSS);
            log.theme(`Theme "${themeName}" applied to globals.css`);
            config?.configurable?.streamCallback?.({ type: 'completed', message: `Theme "${themeName}" applied` });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.theme(`Error applying theme: ${errorMessage}`);
            config?.configurable?.streamCallback?.({ type: 'error', message: `Failed to apply theme` });
        }

        return {};
    };
}
