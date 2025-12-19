// Summary service - generates human-readable summaries for agent responses

export function generateCodeSummary(files: string[], commandCount: number, action: 'created' | 'updated'): string {
    if (files.length === 0) {
        return action === 'created'
            ? "I've set up your project! Let me know what changes you'd like to make."
            : "I've reviewed your request but no changes were needed.";
    }

    // Determine what kind of work was done based on file types
    const fileNames = files.map(f => f.split('/').pop() || f);
    const hasComponents = files.some(f => f.includes('/components/') || f.includes('Component'));
    const hasStyles = files.some(f => f.endsWith('.css') || f.endsWith('.scss'));
    const hasApp = files.some(f => f.includes('App.tsx') || f.includes('App.jsx') || f.includes('page.tsx'));
    const hasPages = files.some(f => f.includes('/pages/') || f.includes('/app/'));

    if (action === 'created') {
        // Initial project creation
        let summary = "I've created your project";

        if (hasApp && hasComponents) {
            summary += " with the main app and components";
        } else if (hasApp) {
            summary += " with the main application";
        } else if (hasComponents) {
            summary += " with the necessary components";
        }

        if (commandCount > 0) {
            summary += " and installed the dependencies";
        }

        summary += ". Let me know what changes you'd like!";
        return summary;
    } else {
        // Updates/iterations
        let summary = "Done! I've updated";

        if (hasStyles && !hasComponents && !hasApp) {
            summary += " the styling";
        } else if (hasComponents && files.length === 1) {
            summary += ` the ${fileNames[0]?.replace('.tsx', '').replace('.jsx', '')} component`;
        } else if (hasApp && files.length === 1) {
            summary += " the main app";
        } else if (files.length <= 2) {
            summary += ` ${fileNames.join(' and ')}`;
        } else {
            summary += ` ${files.length} files including ${fileNames.slice(0, 2).join(', ')}`;
        }

        summary += " as requested. Anything else you'd like me to change?";
        return summary;
    }
}
